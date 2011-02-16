#! /Users/nathan/sw/bin/node
//#! /usr/bin/env node


// queue primitives
var Q_TYPE = "net.stemstorage.queue-item";
function putItem(db, id, item, asyncReturn) {
    var doc = {};
    doc[Q_TYPE] = true;
    doc.timestamp = (new Date).toJSON();
    doc.item = item;
    db.http("PUT", doc, id, null, function (status, response) {
        asyncReturn(status === 201, response);
    });
}

function getItems(db, num_desired, item_timeout, respond) {
    var items = [];
    function gather(params, yield) {
        db.get("_all_docs", {include_docs:true, skip:params.skip, limit:params.limit}, function (response) {
            response.rows.filter(function (r) { return r.doc[Q_TYPE]; }).forEach(function (row) {
                var doc = row.doc;
                if (doc.locked_until) {
                    var timeNow = (new Date).toJSON();
                    console.log(timeNow, doc.locked_until, timeNow < doc.locked_until);
                    if (timeNow < doc.locked_until) {
                        return;
                    }
                }
                
                doc.locked_until = new Date(Date.now() + 1000 * item_timeout).toJSON();
                db.http("PUT", doc, doc._id, null, function (status, response) {
                    if (status === 201) {
                        doc._rev = response.rev;
                        yield(doc);
                    }
                });
            });
        });
    }
    function send() {
        respond({json:{items:items}});
    }
    
    var attempts = 0, skip = 0, retry;
    function attempt() {
        // TODO: retry only after all docs have been attempted, and don't read off end of _all_docs
        attempts += 1;
        console.log("Attempt", attempts);
        if (attempts < 5) {     // gather items for half a second tops
            retry = setTimeout(arguments.callee, 100);
            var limit = num_desired;
            gather({limit:limit, skip:skip}, function (item) {
                items.push(item);
                if (items.length == num_desired) {
                    clearTimeout(retry);
                    send();
                }
            });
            skip += limit;
        } else {
            send();
        }
    }
    attempt();
}



var couch = require('./couch.node.js');
var db = new couch.Database("http://localhost:5984/qtest");

couch.External2(function (req, respond) {
    //return respond({body:"<h1>Hello World!</h1>\n<pre>\n" + JSON.stringify(req, null, 4) + "</pre>"});
    
    if (req.path.indexOf("favicon.ico") !== -1) {
        respond({code:404, body:"Go away silly browser.\n"});
        return;
    }
    
    if (req.method === "GET") {
        getItems(db, parseInt(req.query.count || 1), parseFloat(req.query.timeout || 10.0), respond);
    } else if (req.method === "POST") {
        putItem(db, req.uuid, {}, function () {
            respond({body:"It shall be done.\n"});
        });
    }
    
}, {port:8888, db:db});
