module.exports = function() {
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
}