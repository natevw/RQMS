var SERVER = "http://localhost:5984/";
var Q_TYPE = "net.stemstorage.queue-item";


// queue primitives
function putItem(db, id, value, asyncReturn) {
    var doc = {};
    doc[Q_TYPE] = true;
    doc.timestamp = (new Date).toJSON();
    doc.value = value;
    db.http("PUT", doc, id, null, function (status, response) {
        asyncReturn(status === 201, response);
    });
}
function deleteItem(db, id, rev, asyncReturn) {
    db.http("DELETE", null, id, {'rev':rev}, function (status, response) {
        asyncReturn(status === 200, response);
    });
}
function getItems(db, num_desired, item_timeout, respond) {
    function gather(params, returnCount, yieldItem) {
        db.get("_all_docs", {include_docs:true, $startkey:params.start, limit:(params.limit + 1)}, function (response) {
            var lastRow = response.rows.pop();
            returnCount(response.rows.length, lastRow.id);
            if (!lastRow) {
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
                    }
                });
            });
        });
    }
    
    var items = [];
    var deadline = Date.now() + 250;    // gather items for a quarter second tops
    var limit = num_desired, start = null;
    function attempt() {
        var remainingItems, fetchCount;
        gather({limit:limit, start:start}, function (count, next) { remainingItems = fetchCount = count; start = next; }, function (item) {
            remainingItems -= 1;
            if (item) {
                items.push(item);
            }
            
            if (remainingItems < 1) {
                limit = num_desired - items.length;
                if (fetchCount === num_desired && limit && Date.now() < deadline) {
                    console.log("RETRY on fetch of", num_desired, "items");
                    process.nextTick(attempt);
                } else {
                    if (fetchCount === num_desired && limit) {
                        console.log("DEADLINE reached, returning items found so far");
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
    //return respond({body:"<h1>Hello World!</h1>\n<pre>\n" + JSON.stringify(req, null, 4) + "</pre>"});
    
    if (req.path.indexOf("favicon.ico") !== -1) {
        respond({code:404, body:"What a daft browser you really are!\n"});
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
            respond({code:400, body:"I'm sorry, but that sort of language simply will not do.\n"});
            return;
        }
        deleteItem(db, ticket[0], ticket[1], function (deleted) {
            if (deleted) {
                respond({body:"Well done, sir!\n"});
            } else {
                respond({code:409, body:"You may have let me know in a more timely fashion.\n"});
            }
        });
    } else if (req.method === "POST") {
        var value;
        try {
            value = JSON.parse(req.body);
        } catch (e) {
            respond({code:400, body:"That's not all the Queen's English now, is it?\n"});
            return;
        }
        putItem(db, req.uuid, value, function (added) {
            if (added) {
                respond({body:"It shall be done.\n"});
            } else {
                respond({code:409, body:"Dear me!\n"});
            }
        });
    }
    
}, {port:7085, db:fakeDB});
