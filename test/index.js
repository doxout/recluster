//moved this from package.json
//some libraries behave better in NODE_ENV=test
process.env.NODE_ENV = 'test';

var request = require('supertest');
var path = require('path');
var recluster = require('../');
//cluster is a singleton
var cluster = require('cluster');
var m = require('object-assign');
var assert = require('assert');
var fs = require('fs-extra');

function passthru() {}

var defaultOptions = {
    respawn: 0.1,
    workers: 2,
    timeout: 1,
    //don't spam the terminal :o
    logger: {
        log: passthru
    }
};

// global handler to quickly spin up recluster
var handler;

// dry
function requestExpectHelloWorld200(cb) {
    request.get('/')
        .expect(200)
        .end(function(err, res) {
            if (err) throw new Error(err);
            assert.equal(res.text, 'hello world\n');
            if (cb) cb();
        });
}

function requestExpectError(cb) {
    request.get('/')
        .end(function(err, res) {
            assert(err instanceof Error, 'err should be an Error');
            assert.equal(err.message, 'connect ECONNREFUSED 127.0.0.1:8000');
            if (cb) cb();
        });
}

/*
We aren't supposed to do fancy things with this module, so calmly wait
for everything to be cleanup up instead of rushing, it avoids all mistakes

@fixme: this is probably a code smell, we should be able to have a listener when everything
is cleaned up on recluster exposed object
 */
function cleanup(cb) {
    if (Object.keys(cluster.workers).length > 0) {
        cluster.on('exit', function exitHandler() {
            if (Object.keys(cluster.workers).length !== 0) return;
            cluster.removeListener('exit', exitHandler);
            cb();
        });
        return handler.terminate();
    }
    cb();
}

//helper to stay dry
function setup(serverFile, options, onReady, beforeReady) {
    onReady = onReady || passthru;
    beforeReady = beforeReady || passthru;
    handler = recluster(path.join(__dirname, 'lib', serverFile), options);
    handler.run();
    beforeReady();
    handler.once('ready', function() {
        onReady();
    });
}

function switchServer(server) {
    try {
        fs.copySync(
            path.join(__dirname, 'lib', server),
            path.join(__dirname, 'lib', 'server-temp.js')
        );
    } catch (err) {
        done(err);
    }
}

request = request('http://localhost:8000');

describe('recluster', function() {

    describe('default', function() {
        before(function(done) {
            setup('server.js', defaultOptions, done);
        });

        it('should have no error', function(done) {
            requestExpectHelloWorld200(done);
        });
    });

    describe('ready event', function() {
        it('should fail if waiting for ready when online', function(done) {
            var options = m({},
                defaultOptions, {
                    readyWhen: 'started'
                });
            setup('server.js', options, function() {
                requestExpectError(done);
            });
        });

        it('should work if waiting for ready when listening', function(done) {
            setup('server.js', defaultOptions, function() {
                requestExpectHelloWorld200(done);
            }, requestExpectError);
        });

        it("should work if waiting for ready when process says he's ready", function(done) {
            var options = m({},
                defaultOptions, {
                    readyWhen: 'ready'
                });
            setup('server-manual-ready.js', options, function() {
                requestExpectHelloWorld200(done);
            }, requestExpectError);
        });
    });

    describe.only('gracefully handle broken script', function() {
        it('it should properly reload', function(done) {
            //put temp as broken
            switchServer('server-broken.js');
            handler = recluster(path.join(__dirname, 'lib', 'server-temp.js'), defaultOptions);
            handler.run();
            switchServer('server.js');
            handler.reload(function() {
                setTimeout(requestExpectHelloWorld200.bind(null, done), 100);
            });
        });
    });

    describe('reload', function() {
        this.timeout(5000);

        var reloaded;
        var i;
        var intervalHandle;
        var tryToDoneEvery = 500;

        beforeEach(function(done) {
            reloaded = false;
            i = 3;

            //1 s timeout
            var options = m({}, defaultOptions, {
                timeout: 0.1
            });
            setup('server.js', options, done);
        });

        it('should gracefully reload in the middle of a request', function(done) {
            //50ms request vs 100ms timeout = request successful
            request.get('/10')
                .expect(200)
                .end(function(err, res) {
                    assert(reloaded, 'reload should be true');
                    if (err) return done(err);
                    //the 2 previous workers are still waiting :o
                    //while the 2 new are also here
                    assert.equal(Object.keys(cluster.workers).length, 4);
                    assert.equal(res.text, 'hello world\n');
                });

            setImmediate(function() {
                handler.reload();
                handler.once('ready', function() {
                    reloaded = true;
                });
            });

            intervalHandle = setInterval(function() {
                if (Object.keys(cluster.workers).length === 2) {
                    clearInterval(intervalHandle);
                    return done();
                }
                --i;
                if (i < 0) {
                    clearInterval(intervalHandle);
                    return done(new Error('recluster did not gracefully handle the reload'));
                }
            }, tryToDoneEvery);
        });

        it('should properly hang up if exceeds timeout', function(done) {
            //200ms request vs 100ms timeout = socket trashed
            request.get('/200')
                .end(function(err, res) {
                    assert(reloaded, 'reloaded should be true');
                    assert.equal(err.message, 'socket hang up');
                });

            setImmediate(function() {
                handler.reload();
                handler.once('ready', function() {
                    reloaded = true;
                });
            });

            intervalHandle = setInterval(function() {
                if (Object.keys(cluster.workers).length === 2) {
                    clearInterval(intervalHandle);
                    return done();
                }
                --i;
                if (i < 0) {
                    clearInterval(intervalHandle);
                    return done(new Error('recluster did not gracefully handle the reload'));
                }
            }, tryToDoneEvery);
        });
    });

    //@FIXME: help me here, no idea what we are supposed to test
    //or even what the proper behavior SHOULD be
    describe('undying', function() {
        this.timeout(20000);

        it('old undying workers should not respond', function(done) {
            //copy unclean to temp
            switchServer('server-unclean.js');

            var options = m({}, defaultOptions, {
                timeout: 1,
                workers: 2
            });

            setup('server-temp.js', options, function() {
                // replace classic to temp
                switchServer('server.js');

                var total = 50;
                var errorCount = 0;
                var successCount = 0;
                var responseCount = 0;

                handler.reload(function() {
                    assert.equal(Object.keys(cluster.workers).length, 4);

                    function responseHandler(err, res) {
                        responseCount++;
                        if (err) {
                            errorCount++;
                        } else {
                            successCount++;
                            assert.equal(res.text, 'hello world\n');
                        }
                        if (responseCount === total) {
                            console.log('errors : ' + errorCount);
                            console.log('successes : ' + successCount);
                            done();
                        }
                    }

                    for (var i = 0; i < total; ++i) {
                        request.get('/')
                            .end(responseHandler);
                    }
                });
            });
        });
    });

    describe('arguments', function() {
        it('without', function(done) {
            setup('server-with-args.js', defaultOptions, function() {
                requestExpectHelloWorld200(done);
            });
        });

        it('should be propagated', function(done) {
            var options = m({}, defaultOptions, {
                args: ['fail']
            });
            setup('server-with-args.js', options, function() {
                request.get('/')
                    .expect(404)
                    .end(function(err, res) {
                        if (err) done(err);
                        assert.equal(res.text, 'FAIL');
                        done();
                    });
            });
        });
    });

    // /**
    //  * Termination tests
    //  * 1) dies ungracefully after 1/2 s (lib/server-die-halfsec.js)
    //  * 2) disconnects  IPC  after 1/2 s (lib/server-disconnect-halfsec.js)
    //  * 3) msgs 'disconnect' after 1/2 s (lib/server-msg-disconnect-halfsec.js)
    //  * Then test if
    //  * 1) they have been replaced quickly
    //  * 2) they have been killed after a while for (2) and (3)
    //  *
    //  * Recommended settings are:
    //  * respawn: 0.01 - for quick respawns
    //  * backoff: 0.01 - for quick respawns
    //  * workers: 2 - to make sure we're not testing only for one
    //  * timeout: 0.3 - to be able to test if timeout works
    //  * before the replacement tries to signal that its dead
    //  *
    //  * I know that timing-based tests are not perfect, but I have no better
    //  * idea at the moment.
    //  */

    function pids() {
        return handler.workers.map(function(w) {
            return w.process.pid;
        });
    }

    var termOptions = {
        respawn: 0.001,
        backoff: 0.001,
        workers: 2,
        timeout: 0.3,
        readyWhen: 'listening',
        logger: {
            log: passthru
        }
    };

    // kill timeout
    var timeoutKill = termOptions.timeout * 1000;

    // Time after which the worker dies
    var timeoutWorker = 500;
    // Time to wait for a reload to happen
    var timeToSpawn = 150;
    // Time necessary to terminate a worker
    var timeToKill = 50;

    describe('termination', function() {
        it('undying server should still get killed because of timeout', function(done) {
            setup('server-die-halfsec.js', termOptions, function() {
                var workerPids1 = pids();
                assert.equal(workerPids1.length, 2);

                setTimeout(function() {
                    var workerPids2 = pids();
                    assert.equal(workerPids2.length, 2);

                    workerPids1.forEach(function(pid1) {
                        workerPids2.forEach(function(pid2) {
                            assert.notEqual(pid1, pid2);
                        });
                    });
                    done();
                }, timeoutWorker + timeToSpawn);
            });
        });

        it('should handle disconnecting servers', function(done) {
            this.timeout(3000);

            setup('server-disconnect-halfsec.js', termOptions, function() {
                assert.equal(pids().length, 2);

                setTimeout(function() {
                    assert.equal(pids().length, 4);
                }, timeoutWorker + timeToSpawn);

                setTimeout(function() {
                    assert.equal(pids().length, 2);
                }, timeoutWorker + timeToSpawn + timeoutKill + timeToKill);

                setTimeout(function() {
                    done();
                }, 2000);
            });
        });

        it('should handle the disconnect command', function(done) {
            this.timeout(3000);

            setup('server-msg-disconnect-halfsec.js', termOptions, function() {
                assert.equal(pids().length, 2);

                setTimeout(function() {
                    assert.equal(pids().length, 4);
                }, timeoutWorker + timeToSpawn);

                setTimeout(function() {
                    assert.equal(pids().length, 2);
                }, timeoutWorker + timeToSpawn + timeoutKill + timeToKill);

                setTimeout(function() {
                    done();
                }, 2000);
            });
        });

        it('should stop when asked to stop', function(done) {
            this.timeout(3000);

            setup('server.js', termOptions, function() {
                handler.stop();
                cleanup(done);
            });
        });
    });

    afterEach(function(done) {
        cleanup(done);
    });
});
