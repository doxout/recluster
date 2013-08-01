var http = require('http');

var s = http.createServer(function(req, res) {
    var params = req.url.split('/').slice(1);
    setTimeout(function() { 
        res.writeHead(500);
        res.end("I am an unclean server\n");
    }, params[0] || 1);
});

s.listen(8000);


setInterval(function() {
    // non-dying server.
    "";
}, 1000);
