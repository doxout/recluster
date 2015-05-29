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
    // Don't exit - to test termination timeout.
    setTimeout(function() {
        console.log('Finally cleaned up');
    }, 5000);

    require('cluster').worker.disconnect();
}, 500);
