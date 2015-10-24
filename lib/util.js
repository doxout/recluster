exports.removeFrom = removeFrom;

function removeFrom(list, item) {
    var index = list.indexOf(item)
    if (index >= 0) list.splice(index, 1)
}
