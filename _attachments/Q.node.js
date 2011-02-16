var SERVER = "http://localhost:5984/";
var Q_TYPE = "net.stemstorage.queue-item";
var APPROX_NUM_CLIENTS = 4;


// queue primitives
function putItem(db, id, value, asyncReturn) {
    var doc = {};
    doc[Q_TYPE] = true;
    doc.timestamp = (new Date).toJSON();
    doc.value = value;
    db.http("PUT", doc, id, null, function (status, response) {
        asyncReturn(status === 201, status, response);
    });
}
function deleteItem(db, id, rev, asyncReturn) {
    db.http("DELETE", null, id, {'rev':rev}, function (status, response) {
        asyncReturn(status === 200, status, response);
    });
}
function getItems(db, num_desired, item_timeout, respond) {
    function gather(params, returnCount, yieldItem) {
        var num_found = 0;
        db.get("_all_docs", {include_docs:true, $startkey:params.start, limit:(params.limit + 1)}, function (response) {
            var nextRow = (response.rows.length > 1) ? response.rows.pop() : null;
            returnCount(response.rows.length || 1, nextRow && nextRow.id);
            if (!response.rows.length) {
                yieldItem(null);
            }
            response.rows.forEach(function (row) {
                var doc = row.doc;
                if (!doc[Q_TYPE]) {
                    return yieldItem(null);
                }
                
                if (doc.locked_until) {
                    var timeNow = (new Date).toJSON();
                    if (timeNow < doc.locked_until) {
                        return yieldItem(null);
                    }
                }
                
                doc.locked_until = new Date(Date.now() + 1000 * item_timeout).toJSON();
                db.http("PUT", doc, doc._id, null, function (status, response) {
                    if (status === 201) {
                        doc._rev = response.rev;
                        yieldItem({ticket:JSON.stringify([doc._id, doc._rev]), value:doc.value});
                        num_found += 1;
                    } else {
                        yieldItem(null);
                    }
                });
            });
        });
    }
    
    var items = [];
    var deadline = Date.now() + 250;    // gather items for a quarter second tops
    var num_needed = num_desired, limit = num_desired * APPROX_NUM_CLIENTS, start = null;
    function attempt() {
        var remainingItems, fetchCount;
        gather({limit:limit, start:start}, function (count, next) { remainingItems = fetchCount = count; start = next; }, function (item) {
            remainingItems -= 1;
            if (item) {
                items.push(item);
            }
            
            if (remainingItems < 1) {
                num_needed = Math.max(num_desired - items.length, 0);
                if (start && num_needed && Date.now() < deadline) {
                    console.log("RETRY on fetch of", num_desired, "items (" + items.length, "found so far)");
                    process.nextTick(attempt);
                } else {
                    if (start && num_needed) {
                        console.log("DEADLINE reached, returning items found so far");
                    } else if (!start) {
                        console.log("NO MORE items available");
                    }
                    respond({json:{items:items}});
                }
            }
        });
    }
    attempt();
}




var couch = require('./couch.node.js');
var fakeDB = new couch.Database(SERVER + "for_uuids");

couch.External2(function (req, respond) {
    if (0 && Math.random() > 0.5) {
        respond({code:500, body:"CHAOS MONKEY-ED!"});
        return;
    }
    
    if (req.path.indexOf("favicon.ico") !== -1) {
        respond({code:404, body:"What a daft browser you really are!"});
        return;
    }
    
    var db = new couch.Database(SERVER + req.path[0]);
    if (req.method === "GET") {
        getItems(db, parseInt(req.query.count || 1), parseFloat(req.query.time || 10.0), respond);
    } else if (req.method === "DELETE") {
        var ticket;
        try {
            ticket = JSON.parse(req.body);
        } catch (e) {
            respond({code:400, body:"I'm sorry, but that sort of language simply will not do."});
            return;
        }
        deleteItem(db, ticket[0], ticket[1], function (deleted, code) {
            if (deleted) {
                respond({body:"Well done, sir!"});
            } else if (code === 409 || code === 404) {
                respond({code:409, body:"You may have let me know in a more timely fashion."});
            } else {
                respond({code:500, body:"Dear me!"});
            }
        });
    } else if (req.method === "POST") {
        var value;
        try {
            value = JSON.parse(req.body);
        } catch (e) {
            respond({code:400, body:"That's not all the Queen's English now, is it?"});
            return;
        }
        putItem(db, req.uuid, value, function (added, code) {
            if (added) {
                respond({code:201, body:"It shall be done."});
            } else {
                respond({code:500, body:"Dear me!"});
            }
        });
    } else {
        respond({code:400, body:"Kindly stop spinning about me."});
    }
    
}, {port:7085, db:fakeDB});
