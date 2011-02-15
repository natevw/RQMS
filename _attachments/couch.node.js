function Database(db_url) {
    this.url = db_url;
    
    var http = require('http');
    var url = require('url');
    
    var db = url.parse(db_url);
    this._request = function (method, full_path, callback) {
        var req_url = url.parse(full_path);
        var req_options = {host:db.hostname, port:db.port};
        req_options.method = method;
        req_options.headers = {'Content-Type': "application/json"};
        req_options.path = req_url.pathname + (req_url.search || '');
        return http.request(req_options, callback);
    };
}
Database.prototype.urlFor = function (path, query) {
    if (path.join) {
        path = path.join("/");
    }
    if (query) {
        path += "?" + Object.keys(query).map(function (key) {
            if (key[0] === '$') {
                return encodeURIComponent(key.slice(1)) + "=" + encodeURIComponent(JSON.stringify(query[key]));
            } else {
                return encodeURIComponent(key) + "=" + encodeURIComponent(query[key]);
            }
        }).join("&");
    }
    return this.url + "/" + path;
};
Database.prototype.http = function (method, obj, path, query, callback) {
    var req = this._request(method, this.urlFor(path, query), function (res) {
        var responseText = "";
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseText += chunk;
        });
        res.on('end', function () {
           callback(res.statusCode, JSON.parse(responseText));
        });
    });
    req.on('error', function () {
        callback(0, null);
    });
    req.write(JSON.stringify(obj));
    req.end();
};
Database.prototype.get = function (path, query, callback) {
    this.http("GET", null, path, query, function (status, result) {
        callback((status === 200) ? result : null);
    });
};


// see http://wiki.apache.org/couchdb/ExternalProcesses for configuration instructions
function External(callback) {
    var lineBuffer = "";
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (chunk) {
       var lines = (lineBuffer + chunk).split("\n");
       lineBuffer = lines.pop();
       lines.forEach(function (line) {
           var request = JSON.parse(line);
           callback(request, function (response) {
               process.stdout.write(JSON.stringify(response));
               process.stdout.write('\n');
               process.stdout.flush();
           });
       });	 	
    });
}

// same callback code, but hosted directly as HTTP server
// e.g. http://davispj.com/2010/09/26/new-couchdb-externals-api.html
function External2(callback, options) {
    var http = require('http');
    var url = require('url');
    var qs = require('querystring');
    
    // catch exceptions and log them, let timeout handler return 500.
    process.on('uncaughtException', function (err) {
      console.log(err.message);
    });
    
    var server = http.createServer(function (req, res) {
        var path_parts = url.parse(req.url);
        
        var wrappedReq = {};
        wrappedReq.method = req.method;
        wrappedReq.path = path_parts.pathname.split('/').slice(1);
        wrappedReq.query = qs.parse(path_parts.query);
        wrappedReq.headers = req.headers;   // TODO: match CouchDB's key case?
        
        wrappedReq.body = "";
        req.setEncoding('utf8');
        req.on('data', function (chunk) {
            wrappedReq.body += chunk;
        });
        req.on('end', function () {
            var waiting = setTimeout(function () {
                console.log("Timed out waiting for response, sending error back to client.");
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({error:true, message:"Internal error processing request"}), 'utf8');
                waiting = null;
            }, 2000);
            callback(wrappedReq, function (wrappedRes) {
                if (!waiting) {
                    // request has already failed
                    return;
                } else {
                    clearTimeout(waiting);
                }
                var type = 'application/octet-stream';
                if (wrappedRes.json) {
                    type = 'application/json';
                    wrappedRes.body = JSON.stringify(wrappedRes.json);
                } else if (wrappedRes.body) {
                    type = 'text/html';
                }
                var headers = wrappedRes.headers || {};
                // TODO: normalize case of header keys
                headers['Content-Type'] || (headers['Content-Type'] = type);
                
                res.writeHead(wrappedRes.code || 200, headers);
                if (wrappedRes.body) {
                    res.end(wrappedRes.body, 'utf8');
                } else if (wrappedRes.base64) {
                    // for some reason res.end(wrappedRes.base64, 'base64') hangs
                    res.end(new Buffer(wrappedRes.base64, 'base64'));
                } else {
                    res.end();
                }
            });
        });
    });
    server.listen(options.port, options.host);
}


exports.Database = Database;
exports.External = External;
exports.External2 = External2;
