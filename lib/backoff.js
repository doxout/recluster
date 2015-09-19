module.exports = function(opt) {

    var optrespawn      = opt.respawn || 1;
    var backoffTimer    = null;
    var lastSpawn       = Date.now();


    function delayedDecreaseBackoff() {
        if (backoffTimer)
            clearTimeout(backoffTimer);

        backoffTimer = setTimeout(function() {

            backoffTimer    = null;
            optrespawn      = optrespawn / 2;

            if (optrespawn <= opt.respawn)
                optrespawn = opt.respawn;
            else
                delayedDecreaseBackoff();

        }, opt.backoff * 1000);
    }

    function getRespawnTime(now) {
        if (opt.backoff)
            optrespawn = Math.min(optrespawn, opt.backoff);

        var nextSpawn   = Math.max(now, lastSpawn + optrespawn * 1000),
            time        = nextSpawn - now;
            lastSpawn   = nextSpawn;

        // Exponential backoff.
        if (opt.backoff) {
            optrespawn *= 2;
            delayedDecreaseBackoff();
        }

        return time;
    }

    return getRespawnTime;
}