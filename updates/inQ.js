function (no_docs_pls, req) {
    if (no_docs_pls) {
        throw Error("New messages only, please.");
    }
    
    var date = require('lib/date');
    
    var doc = {};
    doc._id = req.uuid;
    doc['net.stemstorage.queue-message'] = true;
    doc.message = JSON.parse(req.body);
    doc.timestamp = date.toRFC3339(new Date);
    return [doc, "It shall be done, sir.\n"];
}
