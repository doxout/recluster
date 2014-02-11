var http = require('http');

var s = http.createServer(function(req, res) {
    res.writeHead(200);
    res.end("hello world\n");
});

console.log("Running on port", 8000);
s.listen(8000);

