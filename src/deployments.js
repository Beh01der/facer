var url = require('url');
var fs = require('fs');
var crypto = require('crypto');

var moment = require('moment');
var request = require('request-json');
var unzip = require('unzip-wrapper');
var clone = require('clone');
var parseurl = require('parseurl');
var humanInterval = require('human-interval');

var deployments = [];
var deploymentsPrepared = [];
var resolvedRules = {};

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

function tryFiles(req, deployment) {
    var url = parseurl(req);
    var path = url.pathname;

    var filePath = './data/' + deployment.id + path;

    var stats = null;
    try {
        stats = fs.statSync(filePath);
        if (stats && stats.isDirectory()) {
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

    if (!hash) {
        // no file found
        return null;
    }

    var preparedRule = {
        type: 'file',
        resultPath: filePath,
        md5: hash
    };

    deployment.rules.forEach(function (rule) {
        if (!rule.matchPath || rule.matchPath.test(path)) {
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

    deployment.rules.forEach(function (rule) {
        if (rule.proxyPath && (!rule.matchPath || rule.matchPath.test(path))) {
            preparedRule.resultUrl = path.replace(rule.proxyPath, rule.proxyDownstream);
        }
    });

    return preparedRule.resultUrl ? preparedRule : null;
}

var service = {
    list: deployments,

    createNewDeployment: function(info, callback) {
        var now = Date.now();
        var nowMoment = moment(now);
        info.id = now;
        info.created = nowMoment.format();
        info.updated = nowMoment.format();

        var modified = moment(info.contentModified);
        if (!modified.isValid()) {
            modified = nowMoment;
        }
        info.contentModified = modified.format();

        // fetch data
        var dataUrl = url.parse(info.dataUrl);
        if (!dataUrl) {
            callback('Couldn\'n resolve dataUrl');
        }

        var dataDir = './data/' + info.id;
        fs.mkdirSync(dataDir);

        var dataFile = dataDir + '/deployment.zip';
        var client = request.createClient(dataUrl.protocol + '//' + dataUrl.host);
        client.saveFile(dataUrl.path, dataFile, function(err, res, body) {
            if (err) {
                callback(err);
            } else {
                if (res.statusCode === 200) {
                    var stat = fs.statSync(dataFile);
                    info.dataSize = stat.size;
                    if (info.dataSize) {
                        unzip(dataFile, function (err) {
                            fs.unlink(dataFile, function () {});

                            if (info.state === 'active') {
                                var preparedDeployments = { id: info.id, rules: [] };
                                (info.rules || [{}]).forEach(function(rule){
                                    var newRule = clone(rule);
                                    newRule.contentModified = modified.toDate().getTime();
                                    if (newRule.match && newRule.match.path) {
                                        newRule.matchPath = new RegExp(newRule.match.path);
                                    }
                                    newRule.ageInterval = newRule.age && newRule.age !== "0" ? humanInterval(newRule.age) : 0;

                                    if (newRule.proxy) {
                                        newRule.proxyPath = new RegExp(newRule.proxy.path);
                                        newRule.proxyDownstream = newRule.proxy.downstream;
                                    }

                                    preparedDeployments.rules.push(newRule);
                                });
                                deploymentsPrepared.push(preparedDeployments);
                            }

                            callback(null, info);
                        });
                    } else {

                    }
                } else {

                }
            }
        });

    },

    findRule: function (req, res, next) {
        var url = parseurl(req);
        var path = url.pathname;
        var resolvedRule = resolvedRules[path];

        if (resolvedRule === undefined) {
            var prevFile;
            for (var i = deploymentsPrepared.length - 1; i >= 0; i-- ) {
                var iDeployment = deploymentsPrepared[i];

                var file = tryFiles(req, iDeployment);
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
                    var downstream = tryDownstreams(req, iDeployment);
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
    }
};

module.exports = service;