var nlb = require('../index.js'),
    path = require('path'),
    http = require('http'),
    fs = require('fs'),
    tap = require('tap');

var balancer = null;

var serverjs = path.join(__dirname, 'lib', 'server.js');

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


function setUp(file) {
    return function setUp(t) {
        setServer(file, function(err) {
            if (err) throw err;
            balancer = nlb(path.join(__dirname, 'lib', 'server.js'), {
                respawn: 0.1, 
                workers:2, 
                timeout: 0.5
            });
            balancer.once('listening', function(){ t.end(); });
            balancer.run();
        });
    }
}

function tearDown(t) {
    balancer.terminate();
    t.end();
}


function runTest(desc, file, testfn) {
    if (!testfn) { 
        testfn = file;
        file = 'server-ok.js';
    }
    
    tap.test(desc, function(t) {
        t.test('setup', setUp(file))
        t.test(desc, testfn);
        t.test('teardown', tearDown);
    });
};


runTest("simple balancer", function(t) {
    t.plan(1);
    request({url: 'http://localhost:8000/1'}, function(err) {
        t.ok(!err, "Response received");
        t.end();
    });
});


runTest("async server", "server-async.js", function(t) {
    t.plan(1);
    request({url: 'http://localhost:8000/1'}, function(err) {
        t.ok(!err, "Response received");
        t.end();
    });
});




runTest("broken server", function(t) {
    setServer('server-broken.js', function(err) {
        t.ok(!err, "changing to broken server");
        balancer.reload();
        setTimeout(setServer.bind(this, 'server-ok.js', afterOk), 150);
        function afterOk(err) {
            t.ok(!err, "changing to okay server");
            setTimeout(function() { 
                request({
                    url: 'http://localhost:8000/1'
                }, function(err) {
                    t.ok(!err, "Response received");
                    t.end();
                }); 
            }, 150);
        }
    });  
});

runTest("reload in the middle of a request", function(t) {
    t.plan(1);
    request({url: 'http://localhost:8000/100'}, function(err) {
        t.ok(!err, "Response received");
        t.end();
    });
    setTimeout(balancer.reload.bind(balancer), 10);
});

runTest("old workers dont respond", function(t) {
    setServer('server-unclean.js', function(err) {
        t.ok(!err, "Changing to unending server");
        balancer.reload();
        setServer('server-ok.js', function(err) {
            t.ok(!err, "Changing to normal server");
            var responses = 0, n = 10;
            for (var k = 0; k < n; ++k)
                request({
                    url: 'http://localhost:8000/1'
                }, function(err) {
                    t.ok(!err, 'new worker sent response');
                    if (++responses == n) t.end();
                });
        });
        
    })
});

runTest("server with an endless setInterval", function(t) {
    t.plan(2);
    setServer('server-unclean.js', function(err) {
        t.ok(!err, "Changing to unending server");
        balancer.reload();
        setTimeout(balancer.reload.bind(balancer), 100);
        setTimeout(function() {
            var workerIds = Object.keys(require('cluster').workers);
            t.equal(workerIds.length, 2, "Two workers are active");
            t.end(); // this test will never end
        }, 900)
        
    })
});

