var http = require('http');

var s = http.createServer(function(req, res) {
    var params = req.url.split('/').slice(1);
    setTimeout(function() { 
        throw "Server is broken!");
    }, params[0] || 1);
});

s.listen(8000);

