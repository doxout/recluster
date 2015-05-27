var http = require('http');

if (!process.env.WORKER_ID) {
    throw new Error('env.WORKER_ID not set!');
}

var s = http.createServer(function(req, res) {
    res.writeHead(200);
    res.end('hello world\n');
});

s.listen(8000);

setTimeout(function() {
    process.send({
        cmd: 'disconnect'
    });
    // But don't exit - to test termination timeout.
    setTimeout(function() {
        console.log('Done with cleanup');
    }, 5000);
}, 500);
