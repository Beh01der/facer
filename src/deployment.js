var url = require('url');
var fs = require('fs');
var crypto = require('crypto');

var moment = require('moment');
var request = require('request-json');
var unzip = require('unzip-wrapper');
var clone = require('clone');
var parseurl = require('parseurl');
var send = require('send');
var humanInterval = require('human-interval');

var deployments = [];
var deploymentsStatic = [];
var fileInfo = {};

function lookupFile(url) {
    var info = fileInfo[url];

    if (info === undefined) {
        var prevHash;
        var prevModule;
        var prevFilePath;
        var filePath;
        deployments: for (var i = deploymentsStatic.length - 1; i >= 0; i-- ) {
            var iDeployment = deploymentsStatic[i];
            if (iDeployment.modules.length) {
                filePath = './data/' + iDeployment.id + url;

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

                if (hash) {
                    for (var j = iDeployment.modules.length - 1; j >= 0; j-- ) {
                        var iModule = iDeployment.modules[j];
                        if (iModule.matchUrl.test(url)) {
                            if (prevHash && prevHash !== hash) {
                                break deployments;
                            } else {
                                prevHash = hash;
                                prevModule = iModule;
                                prevFilePath = filePath;
                            }
                        }
                    }
                }
            }
        }

        info = prevModule ? {
            module: prevModule,
            path: prevFilePath
        } : false;

        fileInfo[url] = info;
    }

    return info;
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

                            var staticDeployments = { id: info.id, modules: [] };
                            info.modules.forEach(function(module){
                                if (module.type === 'static') {
                                    var newModule = clone(module);
                                    newModule.contentModified = modified.toDate().getTime();
                                    newModule.matchUrl = new RegExp(newModule.match.url);
                                    newModule.ageInterval = humanInterval(newModule.age);
                                    staticDeployments.modules.push(newModule);
                                }
                            });
                            deploymentsStatic.push(staticDeployments);

                            callback(null, info);
                        });
                    } else {

                    }
                } else {

                }
            }
        });

    },

    serveContent: function(req, res, next) {
        var filePath = parseurl(req).pathname;
        var fileInfo = lookupFile(filePath);

        if (fileInfo) {
            send(req, fileInfo.path, { etag: false, lastModified: false })
                .on('headers', function (res) {
                    res.setHeader('Expires', new Date(Date.now() + fileInfo.module.ageInterval).toUTCString());
                    res.setHeader('Pragma', 'public');
                    var ageSeconds = fileInfo.module.ageInterval / 1000;
                    res.setHeader('Cache-Control', 'public, max-age=' + ageSeconds + ', s-maxage=' + ageSeconds);
                    res.setHeader('Last-Modified', new Date(fileInfo.module.contentModified).toUTCString());
                })
                .pipe(res);
        } else {
            next();
        }

    }
};

module.exports = service;