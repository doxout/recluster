var http = require('http');

var s = http.createServer(function(req, res) {
    res.writeHead(200);
    res.end('unclean\n');
});

s.listen(8000);

setInterval(function() {
    '';
}, 100);
