var http = require('http');

if (!process.env.WORKER_ID) {
    throw new Error('env.WORKER_ID not set!');
}

var s = http.createServer(function(req, res) {
    if (process.argv[2] === 'fail') {
        // we can only communicate with the test through an error. 404 is as good as any.
        res.writeHead(404);
        res.end('FAIL');
    } else {
        res.writeHead(200);
        res.end('hello world\n');
    }
});

s.listen(8000);
