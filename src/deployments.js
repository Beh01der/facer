var url = require('url');
var fs = require('fs');
var crypto = require('crypto');

var moment = require('moment');
var request = require('request-json');
var unzip = require('unzip-wrapper');
var clone = require('clone');
var parseurl = require('parseurl');
var humanInterval = require('human-interval');
var randomstring = require("randomstring");
var fse = require('fs-extra');
var path = require('path');
var commander = require('commander');

var storage;

var deployments = [];
var deploymentsPrepared = [];
var resolvedRules = {};
var fileInfos = {};

/*

resolved rule:

{
    type: 'file',
    resultPath: path to file,
    ageInterval: interval ms,
    contentModified: timestamp,
    md5: file hash
}

or

{
    type: 'downstream',
    resultUrl: 'final downstream url' (w/o query)
}

 */

// initialising storage and loading data
if (commander.mongoUrl) {
    storage = require('./storage-mongo');
} else {
    storage = require('./storage-fs');
}

storage.load(function(loadedDeployments) {
    loadedDeployments.forEach(function (loadedDeployment) {
        updateCreateDeployment(loadedDeployment, true, null, true);
    });
});

function cleanCache() {
    resolvedRules = {};
    fileInfos = {};
}

function fileInfo(path) {
    var info = fileInfos[path];
    if (info !== undefined) {
        return info;
    }

    var stats = null;
    var filePath = path;
    var redirect = false;

    try {
        stats = fs.statSync(filePath);
        if (stats && stats.isDirectory()) {
            if (!filePath.length || filePath[filePath.length - 1] != '/') {
                filePath += '/';
                redirect = true;
            }
            filePath += 'index.html';
            stats = fs.statSync(filePath);
        }
    } catch (e) {
    }

    var hash = null;
    if (stats && stats.isFile()) {
        var md5 = crypto.createHash('md5');
        md5.update(fs.readFileSync(filePath));
        hash = md5.digest('hex');
    }

    if (hash) {
        info = {
            md5: hash,
            path: filePath,
            redirect: redirect
        };
    } else {
        info = null;
    }

    return fileInfos[path] = info;
}

function tryFiles(req, deployment) {
    var url = parseurl(req);
    var path = url.pathname;

    var preparedRule = {
        type: 'file'
    };

    deployment.rules.forEach(function (rule) {
        if (!rule.matchPath || rule.matchPath.test(path)) {
            var filePath = path;
            if (rule.rewritePath) {
                filePath = filePath.replace(rule.rewritePath, rule.rewriteNewPath);
            }

            filePath = './data/' + deployment.id + filePath;

            var file = fileInfo(filePath);
            if (!file) {
                return;
            }

            preparedRule.id = deployment.id;
            preparedRule.name = deployment.name;
            preparedRule.md5 = file.md5;
            preparedRule.redirect = file.redirect;
            preparedRule.resultPath = file.path;
            preparedRule.contentModified = rule.contentModified;
            if (rule.ageInterval !== undefined) {
                preparedRule.ageInterval = rule.ageInterval;
            }
        }
    });

    if (!preparedRule.ageInterval) {
        preparedRule.ageInterval = 0;
    }

    return preparedRule.md5 !== undefined ? preparedRule : null;
}

function tryDownstreams(req, deployment) {
    var url = parseurl(req);
    var path = url.pathname;

    var preparedRule = {
        type: 'downstream'
    };

    deployment.rules.forEach(function (rule) {
        if (rule.proxyDownstream && (!rule.matchPath || rule.matchPath.test(path))) {
            preparedRule.id = deployment.id;
            preparedRule.name = deployment.name;
            preparedRule.resultPath = path;
            preparedRule.downstream = rule.proxyDownstream;
            if (rule.rewritePath) {
                preparedRule.resultPath = preparedRule.resultPath.replace(rule.rewritePath, rule.rewriteNewPath);
            }
        }
    });

    return preparedRule.resultPath ? preparedRule : null;
}

function updateCreateDeployment(info, updateContent, oldDeployment, dontStore) {
    var nowMoment = moment(Date.now());
    if (oldDeployment) {
        info.name = oldDeployment.name;
    }
    info.created = oldDeployment ? oldDeployment.created : nowMoment.format();
    info.updated = nowMoment.format();

    var modified = moment(info.contentModified);
    if (!modified.isValid()) {
        modified = nowMoment;
    }
    info.contentModified = modified.format();

    var oldDeploymentIndex;
    if (oldDeployment) {
        for (var i = 0; i < deployments.length; i++) {
            var d = deployments[i];
            if (d.id === oldDeployment.id) {
                oldDeploymentIndex = i;
                break;
            }
        }

        deployments[oldDeploymentIndex] = info;
        if (!dontStore) {
            storage.update(info, oldDeploymentIndex, updateContent);
        }
    } else {
        deployments.push(info);
        if (!dontStore) {
            storage.create(info);
        }
    }

    cleanCache();

    if (info.state === 'active') {
        var preparedDeployment = { id: info.id, name: info.name, rules: [] };
        (info.rules || [{}]).forEach(function(rule){
            var newRule = clone(rule);
            newRule.contentModified = modified.toDate().getTime();
            if (newRule.match && newRule.match.path) {
                newRule.matchPath = new RegExp(newRule.match.path);
            }

            if (newRule.age && newRule.age !== "0") {
                try {
                    newRule.ageInterval = humanInterval(newRule.age);
                } catch (e) {
                }
            }

            if (!newRule.ageInterval && newRule.age !== undefined) {
                newRule.ageInterval = 0;
            }

            if (newRule.proxy) {
                newRule.proxyDownstream = newRule.proxy.downstream;
            }

            if (newRule.rewrite) {
                newRule.rewritePath = new RegExp(newRule.rewrite.path);
                newRule.rewriteNewPath = newRule.rewrite.newPath;
            }

            preparedDeployment.rules.push(newRule);
        });

        if (oldDeploymentIndex) {
            deploymentsPrepared[oldDeploymentIndex] = preparedDeployment;
        } else {
            deploymentsPrepared.push(preparedDeployment);
        }
    }
}

function getDeploymentByName(name) {
    for (var i = 0; i < deployments.length; i++) {
        var deployment = deployments[i];
        if (deployment.name === name) {
            return deployment;
        }
    }
}

function updateDeploymentContent(info, dataSourceUrl, callback) {
    var dataDir = './data/' + info.id;
    var dataFile = dataDir + '/' + info.id + '.zip';

    fse.emptyDirSync(dataDir);

    var stat;
    if (dataSourceUrl.protocol) {
        // download zip file from http (filex)
        var client = request.createClient(dataSourceUrl.protocol + '//' + dataSourceUrl.host);
        client.saveFile(dataSourceUrl.path, dataFile, function(err, res, body) {
            if (err) {
                console.log('Error downloading zip file from "%s": %j', dataSourceUrl, err);
                callback(err);
            } else {
                if (res.statusCode === 200) {
                    stat = fs.statSync(dataFile);
                    if (stat.size) {
                        unzip(dataFile, function (err) {
                            if (err) {
                                console.log('Error unzipping file "%s": %j', dataFile, err);
                            }

                            callback(err, stat.size);
                        });
                    } else {
                        console.log('Error downloaded file "%s" has no content', dataFile);
                        callback({ message: 'Error downloaded file has no content' });
                    }
                } else {
                    console.log('Error could not download file "%s": %d', dataFile, res.statusCode);
                    callback({ message: 'Error could not download file' });
                }
            }
        });
    } else {
        // try local FS
        var dataSourcePath = path.parse(dataSourceUrl.path);
        if (dataSourcePath.ext === '.zip') {
            // local zip file
            try {
                stat = fs.statSync(dataSourceUrl.path);
                if (stat.isFile() && stat.size) {
                    fse.copy(dataSourceUrl.path, dataFile, function (err) {
                        if (err) {
                            console.log('Error copying file "%s": %j', dataSourceUrl.path, err);
                            callback(err);
                        } else {
                            unzip(dataFile, function (err2) {
                                if (err2) {
                                    console.log('Error unzipping file "%s": %j', dataFile, err2);
                                }

                                callback(err2, stat.size);
                            });
                        }
                    });
                } else {
                    console.log('Error: invalid file "%s"', dataSourceUrl.path);
                    callback({message: 'Error: invalid file'});
                }
            } catch(e) {
                console.log('Error: invalid file "%s": %j', dataSourceUrl.path, e);
                callback({message: 'Error: invalid file'});
            }
        } else {
            // local dir
            try {
                stat = fs.statSync(dataSourceUrl.path);
                if (stat.isDirectory()) {
                    fse.copy(dataSourceUrl.path, dataDir, function(err) {
                        if (err) {
                            console.log('Error: invalid file "%s": %j', dataSourceUrl.path, e);
                        }

                        callback(err, 10000);
                    });
                } else {
                    console.log('Error: not a directory "%s"', dataSourceUrl.path);
                    callback({message: 'Error: not a directory'});
                }
            } catch (e) {
                console.log('Error: invalid file "%s": %j', dataSourceUrl.path, e);
                callback({message: 'Error: invalid file'});
            }
        }
    }
}

function removeDeployment(deployment) {
    for (var i = 0; i < deployments.length; i++) {
        var d = deployments[i];
        if (d.id === deployment.id) {
            deployments.splice(i, 1);
            deploymentsPrepared.splice(i, 1);
            storage.remove(i);
            fse.removeSync('./data/' + d.id);
            cleanCache();
            return;
        }
    }
}

function createOrUpdateDeployment(info, oldDeployment, dontUpdateContent, callback) {
    if (dontUpdateContent) {
        updateCreateDeployment(info, !dontUpdateContent, oldDeployment);
        callback(null, info);
    } else {
        info.id = oldDeployment ? oldDeployment.id : randomstring.generate();

        // fetch data
        var dataSourceUrl;
        if (info.dataUrl) {
            dataSourceUrl = url.parse(info.dataUrl);
            if (!dataSourceUrl) {
                return callback({ message: 'Could not resolve dataUrl' });
            }
        }

        //if (!oldDeployment) {
        //    // this is a new deployment
        //    var existingWithSameName = getDeploymentByName(info.name);
        //    if (existingWithSameName) {
        //        // but deployment with the same name exists - remove it
        //        removeDeployment(existingWithSameName);
        //    }
        //}

        if (dataSourceUrl) {
            // get content
            updateDeploymentContent(info, dataSourceUrl, function(err, size) {
                info.dataSize = size;
                updateCreateDeployment(info, !dontUpdateContent, oldDeployment);
                callback(null, info);
            });
        } else {
            // no content
            info.dataSize = 0;
            updateCreateDeployment(info, !dontUpdateContent, oldDeployment);
            callback(null, info);
        }
    }
}

var service = {
    list: deployments,

    createOrUpdateDeployment: createOrUpdateDeployment,

    findRule: function (req, res, next) {
        var url = parseurl(req);
        var path = url.pathname;
        var resolvedRule = resolvedRules[path];

        if (resolvedRule === undefined) {
            var prevFile;
            for (var i = deploymentsPrepared.length - 1; i >= 0; i-- ) {
                var deployment = deploymentsPrepared[i];

                var file = tryFiles(req, deployment);
                if (file) {
                    if (prevFile && prevFile.md5 !== file.md5) {
                        // for downstream just get the first match
                        resolvedRule = prevFile;
                        break;
                    } else {
                        prevFile = file;
                        if (!file.ageInterval) {
                            // when ageInterval = 0 just get the first match
                            break;
                        }
                    }
                } else {
                    var downstream = tryDownstreams(req, deployment);
                    if (downstream) {
                        resolvedRule = downstream;
                        break;
                    }
                }
            }

            if (prevFile && !resolvedRule) {
                resolvedRule = prevFile;
            }

            if (resolvedRule === undefined) {
                // nothing found - don't search next time
                resolvedRule = false;
            }

            resolvedRules[path] = resolvedRule;
        }

        req.rule = resolvedRule;

        next();
    },

    removeDeployment: removeDeployment,

    getDeploymentById: function(id) {
        for (var i = 0; i < deployments.length; i++) {
            var deployment = deployments[i];
            if (deployment.id.toString() === id) {
                return deployment;
            }
        }
    },

    getDeploymentByIndex: function(index) {
        if (index && Math.abs(index) <= deployments.length) {
            return index > 0 ? deployments[index - 1] : deployments[deployments.length + index];
        }
    },

    getDeploymentByName: getDeploymentByName
};

module.exports = service;