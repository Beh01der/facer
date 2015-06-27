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

function cleanCache() {
    deploymentsPrepared = [];
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

            preparedRule.md5 = file.md5;
            preparedRule.redirect = file.redirect;
            preparedRule.resultPath = file.path;
            preparedRule.ageInterval = rule.ageInterval;
            preparedRule.contentModified = rule.contentModified;
        }
    });

    return preparedRule.ageInterval !== undefined ? preparedRule : null;
}

function tryDownstreams(req, deployment) {
    var url = parseurl(req);
    var path = url.pathname;

    var preparedRule = {
        type: 'downstream'
    };

    // TODO downstream must inherit rewrite if matches
    deployment.rules.forEach(function (rule) {
        if (rule.proxyDownstream && (!rule.matchPath || rule.matchPath.test(path))) {
            preparedRule.resultPath = path;
            preparedRule.downstream = rule.proxyDownstream;
            if (rule.rewritePath) {
                preparedRule.resultPath = preparedRule.resultPath.replace(rule.rewritePath, rule.rewriteNewPath);
            }
        }
    });

    return preparedRule.resultPath ? preparedRule : null;
}

function updateCreateDeployment(info, oldDeployment) {
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
    } else {
        deployments.push(info);
    }

    cleanCache();

    if (info.state === 'active') {
        var preparedDeployment = { id: info.id, rules: [] };
        (info.rules || [{}]).forEach(function(rule){
            var newRule = clone(rule);
            newRule.contentModified = modified.toDate().getTime();
            if (newRule.match && newRule.match.path) {
                newRule.matchPath = new RegExp(newRule.match.path);
            }
            newRule.ageInterval = newRule.age && newRule.age !== "0" ? humanInterval(newRule.age) : 0;

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

function updateDeploymentContent(dataDir, dataSourceUrl, callback) {
    var stat;
    var dataFile;
    if (dataSourceUrl.protocol === 'http:') {
        // download zip file from http (filex)
        dataFile = dataDir + '/deployment.zip';
        var client = request.createClient(dataSourceUrl.protocol + '//' + dataSourceUrl.host);
        client.saveFile(dataSourceUrl.path, dataFile, function(err, res, body) {
            if (err) {
                callback(err);
            } else {
                if (res.statusCode === 200) {
                    stat = fs.statSync(dataFile);
                    if (stat.size) {
                        unzip(dataFile, function (err) {
                            fse.removeSync(dataFile);
                            callback(null, stat.size);
                        });
                    } else {

                    }
                } else {

                }
            }
        });
    } else {
        // try local FS
        var dataSourcePath = path.parse(dataSourceUrl.path);
        if (dataSourcePath.ext === '.zip') {
            // local zip file
            // TODO what if path is invalid ? handle errors
            stat = fs.statSync(dataSourceUrl.path);
            if (stat.isFile() && stat.size) {
                dataFile = dataDir + '/' + dataSourcePath.base;
                fse.copy(dataSourceUrl.path, dataFile, function (err) {
                    unzip(dataFile, function (err2) {
                        fse.removeSync(dataFile);
                        callback(err2, stat.size);
                    });
                });
            } else {

            }
        } else {
            // local dir
            stat = fs.statSync(dataSourceUrl.path);
            if (stat.isDirectory()) {
                fse.copy(dataSourceUrl.path, dataDir, function(err) {
                    callback(err, 10000);
                });
            }
        }
    }
}

var service = {
    list: deployments,

    createOrUpdateDeployment: function(info, oldDeployment, dontUpdateContent, callback) {
        if (dontUpdateContent) {
            updateCreateDeployment(info, oldDeployment);
            callback(null, info);
        } else {
            info.id = oldDeployment ? oldDeployment.id : randomstring.generate();

            // fetch data
            var dataSourceUrl = url.parse(info.dataUrl);
            if (!dataSourceUrl) {
                callback('Couldn\'n resolve dataUrl');
            }

            var dataDir = './data/' + info.id;
            fse.emptyDirSync(dataDir);

            updateDeploymentContent(dataDir, dataSourceUrl, function(err, size) {
                info.dataSize = size;
                updateCreateDeployment(info, oldDeployment);
                callback(null, info);
            });
        }
    },

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

    removeDeployment: function(deployment) {
        for (var i = 0; i < deployments.length; i++) {
            var d = deployments[i];
            if (d.id === deployment.id) {
                deployments.splice(i, 1);
                deploymentsPrepared.splice(i, 1);
                cleanCache();
                return;
            }
        }
    },

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

    getDeploymentByName: function(name) {
        for (var i = 0; i < deployments.length; i++) {
            var deployment = deployments[i];
            if (deployment.name === name) {
                return deployment;
            }
        }
    }
};

module.exports = service;