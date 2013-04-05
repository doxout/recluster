var nlb = require('../index.js'),
    request = require('request'),
    path = require('path'),
    fs = require('fs'),
    ncp = require('ncp');

var balancer = null;

serverjs = path.join(__dirname, 'lib', 'server.js');

function setServer(file, done) {
    try {
        ncp(path.join(__dirname, 'lib', file), serverjs, done);
    } catch (e) {
        console.log("Error setting server", e);
        done(e);
    }
}


exports.setUp = function(done) {
    setServer('server-ok.js', function(err) {
        if (err) throw err;
        balancer = nlb(path.join(__dirname, 'lib', 'server.js'), {respawn: 0.2, workers:2});
        balancer.once('listening', function(){ done(); });
        balancer.run();
    });
}

exports["simple balancer"] = function(t) {
    t.expect(1);
    request({url: 'http://localhost:8000/1'}, function(err, res, body) {
        t.ok(!err, "Response received");
        t.done();
    });

}
exports["reload in the middle of a request"] = function(t) {
    t.expect(1);
    request({url: 'http://localhost:8000/100'}, function(err, res, body) {
        t.ok(!err, "Response received");
        t.done();
    });
    setTimeout(balancer.reload.bind(balancer), 50);
}


exports["broken server"] = function(t) {
    t.expect(3);
    setServer('server-broken.js', function(err) {
        t.ok(!err, "Error changing to broken server");
        balancer.reload();
        setTimeout(setServer.bind(this, 'server-ok.js', afterOk), 300);
        function afterOk(err) {
            t.ok(!err, "Error changing to okay server");
            setTimeout(function() { 
                request({
                    url: 'http://localhost:8000/1'
                }, function(err, res, body) {
                    t.ok(!err, "Response received");
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

