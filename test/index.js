var lib = require('./lib/index'),
    runTest = lib.runTest,
    request = lib.request;


runTest("simple balancer", function(t) {
    request({url: 'http://localhost:8000/1'}, function(err) {
        t.ok(!err, "response should have no error");
        t.end();
    });
});

runTest("async server fails if readyWhen = started",
        {file: "server-async.js", readyWhen: 'started'}, function(t) {
    request({url: 'http://localhost:9000/1'}, function(err) {
        t.ok(err, "response should have error: " + err);
        t.end();
    });
});


runTest("async server", {file: "server-async.js"}, function(t) {
    request({url: 'http://localhost:9000/1'}, function(err) {
        t.ok(!err, "response should have no error");
        t.end();
    });
});

runTest("manual ready signal",
        {file: "server-manual-ready.js", readyWhen: 'ready'}, function(t) {
    request({url: 'http://localhost:9001/1'}, function(err) {
        t.ok(!err, "response should have no error");
        t.end();
    });
});




runTest("broken server", function(t) {
    lib.setServer('server-broken.js', function(err) {
        t.ok(!err, "changing to broken server should work");
        lib.balancer.reload();
        setTimeout(lib.setServer.bind(this, 'server-ok.js', afterOk), 150);
        function afterOk(err) {
            t.ok(!err, "changing to okay server");
            setTimeout(function() {
                request({
                    url: 'http://localhost:8000/1'
                }, function(err) {
                    t.ok(!err, "response should have no error");
                    t.end();
                });
            }, 150);
        }
    });
});

runTest("reload in the middle of a request", function(t) {
    request({url: 'http://localhost:8000/100'}, function(err) {
        t.ok(!err, "Response received");
        t.end();
    });
    setTimeout(lib.balancer.reload.bind(lib.balancer), 10);
});

runTest("old workers dont respond", function(t) {
    lib.setServer('server-non-dying.js', afterNonDying)
    function afterNonDying(err) {
        t.ok(!err, "should change to unending server");
        lib.balancer.reload(afterReloadUnending);
    }
    function afterReloadUnending() {
        lib.setServer('server-ok.js', afterOk);
    }
    function afterOk() {
        lib.balancer.reload(afterReloadOk)
    }
    function afterReloadOk(err) {
        t.ok(!err, "should change to normal server");
        var responses = 0, n = 10;
        function requestComplete(err) {
            t.ok(!err, 'response should be from new worker ' + err);
            if (++responses == n) setTimeout(checkActive, 350);
        }
        for (var k = 0; k < n; ++k)
            request({url: 'http://localhost:8000/1'}, requestComplete);
    }
    function checkActive()  {
        var active =
            Object.keys(require('cluster').workers).length;
        t.equals(active, 2, 'only 2 worksers should be active');
        t.end();
    }
});

runTest("server with an endless setInterval", function(t) {
    lib.setServer('server-non-dying.js', function(err) {
        t.ok(!err, "should change to unending server");
        lib.balancer.reload(function() {
            setTimeout(lib.balancer.reload.bind(lib.balancer, function() {
                setTimeout(checkDead, 400); // 400 = timeout + 100ms spawntime
            }), 10);
        });
        function checkDead() {
            t.equal(lib.balancer.workers.length, 2, "only 2 workers should be active");
            t.end(); // this test will never end
        }
    })
});

runTest("server with arguments", {file: 'server-with-args.js', args: ['fail']}, function(t) {
    request({url: 'http://localhost:8000'}, function(err) {
        t.equal(err, 404, 'should get 404 error');
        t.end();
    });
});

