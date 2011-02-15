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


exports.Database = Database;
exports.External = External;