var httpProxy = require('http-proxy');
var parseurl = require('parseurl');

var proxy = httpProxy.createProxyServer({});
proxy.on('error', function (err, req, res) {
    var rule = req.rule;

    res.writeHead(502, {'Content-Type': 'text/plain'});
    res.write('Bad Gateway for: ' + (rule ? rule.downstream + rule.resultPath : null || req.url) + ' - ' + err);
    res.end();
});

module.exports = function (req, res, next) {
    var rule = req.rule;
    if (rule && rule.type === 'downstream') {
        var url = parseurl(req);
        req.url = rule.resultPath;
        if (url.search) {
            req.url  += url.search;
        }

        delete req._parsedUrl;

        proxy.web(req, res, { target: rule.downstream });
    } else {
        next();
    }

};