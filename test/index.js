var nlb = require('../index.js'),
    request = require('request'),
    path = require('path'),
    fs = require('fs'),
    ncp = require('ncp');

var balancer = null;

serverjs = path.join(__dirname, 'lib', 'server.js');

function setServer(file, done) {
    ncp(path.join(__dirname, 'lib', file), serverjs, done);
}


exports.setUp = function(done) {
    setServer('server-ok.js', function(err) {
        if (err) throw err;
        balancer = nlb(path.join(__dirname, 'lib', 'server.js'), {respawn: 0.2});
        balancer.once('listening', function(){ done(); });
        balancer.run();
    });
}

exports["simple balancer"] = function(t) {
    t.expect(1);
    request({url: 'http://localhost:8000/1'}, function(err, res, body) {
        t.ok(true, "Response received");
        t.done();
    });

}
exports["reload in the middle of a request"] = function(t) {
    t.expect(1);
    request({url: 'http://localhost:8000/60'}, function(err, res, body) {
        t.ok(true, "Response received");
        t.done();
    });
    setTimeout(balancer.reload.bind(balancer), 30);
}


exports["broken server"] = function(t) {
    t.expect(1);
    setServer('server-broken.js', function(err) {
        if (err) throw err;
        balancer.reload();
        setTimeout(setServer.bind(this, 'server-ok.js', afterOk), 300);
        function afterOk(err) {
            if (err) throw err;
            setTimeout(function() {
                request({url: 'http://localhost:8000/1'}, function(err, res, body) {
                    t.ok(true, "Response received");
                    t.done();
                });
            }, 300);
        }
    });  
};

exports.tearDown = function(done) {
    balancer.terminate();
    done();
}

