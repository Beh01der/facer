var send = require('send');
var parseurl = require('parseurl');

var maxAgeLimit = 60*60*24*360*1000;
module.exports = function(req, res, next) {
    var rule = req.rule;
    if (rule && rule.type === 'file') {
        if (rule.redirect) {
            res.setHeader('Location',  parseurl(req).pathname + '/');
            res.sendStatus(302);
        } else {
            send(req, rule.resultPath, { etag: false, lastModified: false })
                .on('headers', function (res) {
                    if (rule.ageInterval) {
                        var maxAge = Math.min(rule.ageInterval, maxAgeLimit);
                        var maxAgeSeconds = Math.round(maxAge / 1000);
                        var expires = new Date(Date.now() + maxAge);

                        res.setHeader('Pragma', 'public');
                        res.setHeader('Expires', expires.toUTCString());
                        res.setHeader('Cache-Control', 'public, max-age=' + maxAgeSeconds + ', s-maxage=' + maxAgeSeconds);
                        //res.setHeader('Cache-Control', 'public');
                        res.setHeader('Last-Modified', new Date().toUTCString());
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