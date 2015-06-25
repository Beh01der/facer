var send = require('send');
var parseurl = require('parseurl');

module.exports = function(req, res, next) {
    var rule = req.rule;
    if (rule && rule.type === 'file') {
        if (rule.redirect) {
            res.setHeader('Location',  parseurl(req).pathname + '/');
            res.send(302);
        } else {
            send(req, rule.resultPath, { etag: false, lastModified: false })
                .on('headers', function (res) {
                    if (rule.ageInterval) {
                        res.setHeader('Pragma', 'public');
                        res.setHeader('Expires', new Date(Date.now() + rule.ageInterval).toUTCString());
                        var ageSeconds = rule.ageInterval / 1000;
                        res.setHeader('Cache-Control', 'public, max-age=' + ageSeconds + ', s-maxage=' + ageSeconds);
                        res.setHeader('Last-Modified', new Date(rule.contentModified).toUTCString());
                    } else {
                        res.setHeader('Pragma', 'no-cache');
                        res.setHeader('Expires', new Date(Date.now() - 100000000000).toUTCString());
                        res.setHeader('Cache-Control', 'public, max-age=0, no-cache, no-store, must-revalidate');
                        res.setHeader('Last-Modified', new Date().toUTCString());
                    }
                })
                .pipe(res);
        }
    } else {
        next();
    }
};