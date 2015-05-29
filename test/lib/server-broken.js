var http = require('http');

var s = http.createServer(function(req, res) {
    // The syntax error is intentional
    // It tests if recluster handles the broken server case gracefully.
    throw new Error('Server is broken!';
});

s.listen(8000);
