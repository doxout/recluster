var nlb = require('../../index.js'),
    path = require('path'),
    http = require('http'),
    fs = require('fs'),
    tap = require('tap');

var balancer = null;

var serverjs = path.join(__dirname, 'server.js');

function request(opt, cb) {
    http.get(opt.url, function(res) {
        if (res.statusCode == 200)
            return cb(null);
        return cb(res.statusCode);
    }).on('error', function(err) {
        cb(err || "Generic error");
    });
}


function setServer(file, done) {
    try {
        var source = path.join(__dirname,  file);
        fs.readFile(source, function(err, data) {
            if (err) return done(err);
            fs.writeFile(serverjs, data, function(err) {
                if (err) return done(err);
                return done();
            });
        });
    } catch (e) {
        console.log("Error setting server", e, file);
        done(e);
    }
}


function setUp(opt) {
    return function setUp(t) {
        setServer(opt.file, function(err) {
            if (err) throw err;
            var options = {
                respawn: 0.1,
                workers:2,
                timeout: 0.3
                //readyWhen: 'started'
            };
            for (var key in opt) options[key] = opt[key];

            exports.balancer = balancer = nlb(path.join(__dirname, 'server.js'), options);
            balancer.once('ready', function() {
                t.end();
            });
            balancer.run();
        });
    }
}

function tearDown(t) {
    balancer.terminate();
    t.end();
}


function runTest(desc, opt, testfn) {
    if (!testfn) {
        testfn = opt;
        opt = {file: 'server-ok.js'};
    }
    tap.test(desc, function(t) {
        t.test('-> setup', setUp(opt))
        t.test('-> ' + desc, testfn);
        t.test('-> teardown', tearDown);
    });
}


exports.runTest = runTest;
exports.balancer = balancer;
exports.setServer = setServer;
exports.request = request;
