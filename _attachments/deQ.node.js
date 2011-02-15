#! /Users/nathan/sw/bin/node
//#! /usr/bin/env node

var couch = require('./couch.node.js');
var MSG_TYPE = "net.stemstorage.queue-message";

couch.External(function (req, asyncReturn) {
    var db = new couch.Database("http://" + req.headers['Host'] + "/" + req.info.db_name);
    var timeNow = (new Date).toJSON();
    
    db.get("_all_docs", {include_docs:true, limit:10}, function (response) {
        var tasks = [];
        response.rows.forEach(function (row) {
            if (!row.doc[MSG_TYPE]) return;
            // TODO: check if unlocked (or at least unlockable), (re-)lock and only *then* return as a task.
            tasks.push(row.doc.message);
        });
        asyncReturn({body:"<h1>Hello World!</h1>\n<pre>\n" + JSON.stringify(tasks, null, 4) + "</pre>"});
    });
});
