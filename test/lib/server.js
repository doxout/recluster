var http = require('http');

if (!process.env.WORKER_ID) {
    throw new Error('env.WORKER_ID not set!');
}

var s = http.createServer(function(req, res) {
    var params = req.url.split('/').slice(1);
    if (params[0] === '') {
        res.writeHead(200);
        res.end('hello world\n');
    } else {
        setTimeout(function() {
            res.writeHead(200);
            res.end('hello world\n');
        }, params[0] || 1);
    }
});

s.listen(8000);
