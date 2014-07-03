var http = require('http');

var s = http.createServer(function(req, res) {
    var params = req.url.split('/').slice(1);
    setTimeout(function() {
        // The syntax error is intentional
        // It tests if recluster handles the broken server case gracefully.
        throw "Server is broken!");
    }, params[0] || 1);
});

s.listen(8000);

