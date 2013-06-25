var numCPUs = require('os').cpus().length;
var cluster = require('cluster');
var EE      = require('events').EventEmitter;


function each(obj, fn) { for (var key in obj) fn(key, obj[key]); }


var isProduction = process.env.NODE_ENV == 'production';

/**
 * Creates a load balancer
 * @param file        {String} path to the module that defines the server
 * @param opt         {Object} options
 * @param opt.workers {Number} number of active workers
 * @param opt.timeout {Number} kill timeout for old workers after reload (sec)
 * @param opt.respawn {Number} min time between respawns when workers die
 * @param opt.backoff {Number} max time between respawns when workers die
 * @return - the balancer. To run, use balancer.run() reload, balancer.reload()
 */
module.exports = function(file, opt) {

    opt = opt || {};
    opt.workers = opt.workers || numCPUs;
    opt.timeout = opt.timeout || (isProduction ? 3600 : 1);
    var optrespawn =  opt.respawn || 1;

    var backoffTimer;

    opt.port = opt.port || process.env.PORT || 3000;

    var self = new EE();

    var respawners = (function() {
        var items = [];
        var self = {};
        self.cancel = function() {
            items.forEach(function(item) {
                clearTimeout(item);
            });
            items = [];
        };
        self.add = function(t) {
            items.push(t);
        };
        self.done = function(t) {
            items.splice(items.indexOf(t), 1);
        };
        return self;
    }());


    var lastSpawn = Date.now();

    function delayedDecreaseBackoff() {
        if (backoffTimer) clearTimeout(backoffTimer);
        backoffTimer = setTimeout(function() { 
            backoffTimer = null;
            optrespawn = optrespawn / 2; 
            if (optrespawn <= opt.respawn)
                optrespawn = opt.respawn;
            else
                delayedDecreaseBackoff();
        }, opt.backoff * 1000);
    }

    function workerExit(worker) {
        if (worker.suicide) return;
        var now = Date.now();

        if (opt.backoff) 
            optrespawn = Math.min(optrespawn, opt.backoff);

        var nextSpawn = Math.max(now, lastSpawn + optrespawn * 1000),
            time = nextSpawn - now;
            lastSpawn = nextSpawn;

        // Exponential backoff.
        if (opt.backoff) {
            optrespawn *= 2;
            delayedDecreaseBackoff();
        }

        console.log('worker #' + worker._rc_wid 
                    + ' (' + worker.id + ') died, respawning in', time);
        var respawner = setTimeout(function() { 
            respawners.done(respawner);
            cluster.fork({WORKER_ID: worker._rc_wid})._rc_wid = worker._rc_wid;
        }, time);

        respawners.add(respawner);

    }
    function workerListening(w, adr) {
        self.emit('listening', w, adr);            
    }

    
    self.run = function() {
        if (!cluster.isMaster) return;
        cluster.setupMaster({exec: file});
        for (var i = 0; i < opt.workers; i++) {
            cluster.fork({WORKER_ID: i})._rc_wid = i;
        }
        
        cluster.on('exit', workerExit);
        cluster.on('listening', workerListening);

    }

    self.reload = function() {
        if (!cluster.isMaster) return;
        respawners.cancel();

        each(cluster.workers, function(id, worker) {

           function allListening(cb) {
               var listenCount = opt.workers;
               var self = this;
               return function() {
                   if (!--listenCount) cb.apply(self, arguments);
               };
           }
           var stopOld = allListening(function() {
                var killfn = worker.kill ? worker.kill.bind(worker) 
                                         : worker.destroy.bind(worker);
                if (opt.timeout > 0) {
                    var timeout = setTimeout(killfn, opt.timeout * 1000);
                    worker.on('exit', clearTimeout.bind(this, timeout));
                } else {
                    killfn();
                }
                // possible leftover worker that has no channel estabilished 
                // will throw
                try { worker.disconnect(); } catch (e) { }
                cluster.removeListener('listening', stopOld);
            });

            cluster.on('listening', stopOld);
        });
        for (var i = 0; i < opt.workers; ++i) 
            cluster.fork({WORKER_ID: i})._rc_wid = i;
 
    };

    self.terminate = function() {
        if (!cluster.isMaster) return;
        try {
        cluster.removeListener('exit', workerExit);
        cluster.removeListener('listening', workerListening);
        respawners.cancel();
        each(cluster.workers, function(id, worker) {
            if (worker.kill)
                worker.kill('SIGKILL');
            else
                worker.destroy();
        });
        } catch (e) {
            console.log("terminate error", e);
        }
    }

    return self;

};

