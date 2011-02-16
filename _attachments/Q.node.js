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
function fetchItems(db, params, yield) {
    db.get("_all_docs", {include_docs:true, skip:params.skip, limit:params.limit}, function (response) {
        response.rows.filter(function (r) { return r.doc[Q_TYPE]; }).forEach(function (row) {
            var doc = row.doc;
            if (doc.locked_until) {
                var timeNow = (new Date).toJSON();
                if (timeNow < doc.locked_until) {
                    return;
                }
            }
            
            doc.locked_until = new Date(Date.now() + 1000 * params.item_timeout).toJSON();
            db.http("PUT", doc, doc._id, null, function (status, response) {
                if (status === 201) {
                    doc._rev = response.rev;
                    yield(doc);
                }
            });
        });
    });
}




var couch = require('./couch.node.js');
var db = new couch.Database("http://localhost:5984/qtest");

function getItems(num_desired, respond) {
    var items = [];
    function gather(previousAttempts, check) {
        fetchItems(db, {limit:num_desired, skip:(previousAttempts * num_desired), item_timeout:2.5}, function (item) {
            items.push(item);
            check();
        });
    }
    function send() {
        respond({json:{items:items}});
    }
    
    var attempts = 0, retry;
    function attempt() {
        attempts += 1;
        console.log("Attempt", attempts);
        if (attempts < 10) {
            retry = setTimeout(arguments.callee, 100);
            gather(attempts, function () {
                if (items.length == ITEMS_DESIRED) {
                    clearTimeout(retry);
                    send();
                }
            });
        } else {
            send();
        }
    }
    attempt();
}

couch.External2(function (req, respond) {
    //return respond({body:"<h1>Hello World!</h1>\n<pre>\n" + JSON.stringify(req, null, 4) + "</pre>"});
    getItems(1, respond);
}, {port:8888, db:db});
