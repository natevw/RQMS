var SERVER = "http://localhost:5984/";
var Q_TYPE = "net.stemstorage.queue-item";


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
var pendingClaims = {};
function getItems(db, num_desired, item_timeout, respond) {
    function gather(params, returnCount, yieldItem) {
        var num_attempted = 0;
        db.get("_all_docs", {include_docs:true, $startkey:params.start, limit:(params.limit + 1)}, function (response) {
            var nextRow = (response.rows.length > params.limit) ? response.rows.pop() : null;
            returnCount(response.rows.length, nextRow && nextRow.id);
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
                
                if (pendingClaims[row.id]) {
                    return yieldItem(null);
                }
                
                if (num_attempted >= params.num_desired) {
                    return yieldItem(null);
                }
                
                doc.locked_until = new Date(Date.now() + 1000 * item_timeout).toJSON();
                db.http("PUT", doc, doc._id, null, function (status, response) {
                    if (status === 201) {
                        doc._rev = response.rev;
                        yieldItem({ticket:JSON.stringify([doc._id, doc._rev]), value:doc.value});
                    } else {
                        console.log("Failed to grab desired job!");
                        yieldItem(null);
                    }
                    // hack to avoid another in-flight _all_docs request from trying job right after we've given it out
                    setTimeout(function () { delete pendingClaims[row.id]; }, 1000 * Math.min(5, item_timeout / 2));
                });
                pendingClaims[row.id] = true;
                num_attempted += 1;
            });
        });
    }
    
    var items = [];
    var deadline = Date.now() + 250;    // re-try item gathering for a quarter second tops
    var compaction = setTimeout(function () {   // trigger database compaction if first gather attempt goes past deadline
        db.http('POST', null, "_compact", null, function (status, response) {
            if (status === 202) {
                console.log("COMPACTION requested for database");
            } else {
                console.log("FAILED to start compaction:", response);
            }
        });
    }, 300);
    var num_needed = num_desired, limit = num_desired + parseInt(Object.keys(pendingClaims).length / 2), next = null, retries = 0;
    function attempt() {
        var remainingItems;
        gather({num_desired:num_needed, limit:limit, start:next}, function (count, nextId) {
            if (!count) {
                respond({json:{items:[]}});
            } else {
                remainingItems = count;
                next = nextId;
            }
        }, function (item) {
            remainingItems -= 1;
            if (item) {
                items.push(item);
            }
            
            if (remainingItems < 1) {
                num_needed = Math.max(num_desired - items.length, 0);
                if (next && num_needed && Date.now() < deadline) {
                    retries += 1;
                    console.log("RETRY", retries, "on fetch");
                    process.nextTick(attempt);
                } else {
                    if (next && num_needed) {
                        console.log("DEADLINE reached, returning items found so far");
                    } else if (!next && num_needed) {
                        console.log("NO MORE items available, returning items found so far");
                    }
                    respond({json:{items:items}});
                    clearTimeout(compaction);
                }
            }
        });
    }
    attempt();
}




var couch = require('./couch.node.js');

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
        putItem(db, req.query.id, value, function (added, code) {
            if (added) {
                respond({code:201, body:"It shall be done."});
            } else {
                respond({code:500, body:"Dear me!"});
            }
        });
    } else {
        respond({code:400, body:"Kindly stop spinning about me."});
    }
    
}, {port:7085});
