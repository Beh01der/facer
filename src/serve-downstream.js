var httpProxy = require('http-proxy');
var proxy = httpProxy.createProxyServer({});

module.exports = function (req, res, next) {
    var rule = req.rule;
    if (rule && rule.type === 'downstream') {
        proxy.web(req, res, { target: 'http://127.0.0.1:5060' });
    } else {
        next();
    }

};