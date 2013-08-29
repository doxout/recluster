var http = require('http');

if (null == process.env.WORKER_ID) 
    throw new Error("env.WORKER_ID not set!");

var s = http.createServer(function(req, res) {
    var params = req.url.split('/').slice(1);
    setTimeout(function() { 
        res.writeHead(200);
        res.end("hello world\n");
    }, params[0] || 1);
});


s.listen(9001);

setTimeout(function() {
    process.send({cmd:'ready'});
}, 200);

