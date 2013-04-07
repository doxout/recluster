var nlb = require('../index.js'),
    path = require('path'),
    http = require('http'),
    fs = require('fs');

var balancer = null;

serverjs = path.join(__dirname, 'lib', 'server.js');

function request(opt, cb) {
    http.get(opt.url, function(res) {
        if (res.statusCode == 200) return cb(null);
        return cb(res.statusCode);
    }).on('error', cb);
}


function setServer(file, done) {
    try {
        var source = path.join(__dirname, 'lib', file);
        fs.readFile(source, function(err, data) {
            if (err) return done(err);
            fs.writeFile(serverjs, data, function(err) {
                if (err) return done(err);
                return done();
            });
        });
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

exports["reload in the middle of a request"] = function(t) {
    t.expect(1);
    request({url: 'http://localhost:8000/100'}, function(err, res, body) {
        t.ok(!err, "Response received");
        t.done();
    });
    setTimeout(balancer.reload.bind(balancer), 50);
}

exports["simple balancer"] = function(t) {
    t.expect(1);
    request({url: 'http://localhost:8000/1'}, function(err, res, body) {
        t.ok(!err, "Response received");
        t.done();
    });

}



exports.tearDown = function(done) {
    balancer.terminate();
    done();
}

