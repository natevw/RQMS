# Relaxed Queue Management System #

Relaxed Queue Management System (RQMS) is an simple low-latency job/message distribution manager using CouchDB for reliable persistence. It is a somewhat EXPERIMENTAL use of CouchDB, see the "Deficiencies" section below.

## What's included ##

RQMS provides an HTTP server as well as a Python client for said server.

* `Q.node.js` is the node.js-based HTTP server (running on port 7085 by default) that essentially serves as a smart proxy to your CouchDB instance (found on localhost:5984 by default).

* `rqms.py` is the Python client which provides a [Queue](http://docs.python.org/library/queue.html)-inspired interface and some error handling in connecting to the Q server.

## Job model ##

RQMS's job lifecycle is inspired by the model used for [Amazon's Simple Queue Service](http://docs.amazonwebservices.com/AWSSimpleQueueService/latest/SQSGettingStartedGuide/), with one notable extension. Essentially, jobs are created by posting to a named queue. Jobs are then "fetched" by being locked for a requested time interval, and must be deleted within this interval to avoid being reprocessed.

Following Amazon's model, jobs are given unique and mostly meaningless IDs on creation. However, it was found useful to have an alternate form of job that acts semantically more like a boolean flag ("state changed, please [re]process") rather than a discrete task ("do this once"); in support of this RQMS also supports "setting" named jobs — if an existing named task already exists it will be overwritten, even if it was already in progress.

## Setup ##

1. Create dedicated CouchDB databases (on localhost) for each queue.
2. Start the Q server: `node _attachments/Q.node.js`
3. Use the Python library or the direct HTTP interface on port 7085 to add and fetch jobs.

## Documentation ##

### Python API ###

* `q = Queue(url, time=30.0, batch_size=1, multiple_ok=False)` - initialize a new Queue object with the given `url` (e.g. "http://localhost:7085/dbname"). If fetching items, make sure your code can comfortably process `batch_size` objects within `time` seconds. If fetching items from a queue with "set" semantics (rather than "put" semantics), set `multiple_ok` to True.
* `q.put(item)` - add a work item to the queue. `item` may be an JSON type: dict, array, string, number, boolean, null. The RQMS library will automatically generate a unique sequential internal item id.
* `q.set(jobid, item)` - set a named task to the given `item`'s value.
* `item = q.get()` - fetch an item from the queue; blocks until at least one item is available. If the queue instance is constructed with a `batch_size` greater than 1, this call may return locally cached items fetched in bulk. `item.value` contains original task data; if this data was a dictionary the keys also directly available on the returned item (which is a subclass of Python's built-in dict).
* `q.task_done(item)` - inform the queue that the item has been successfully processed and should be deleted.
* `q.foreach(process_item, catch_errors=False)` - Helper function that automatically gets a task item and passes it as the only parameter to the `process_item` callback, and marks the task as done if no exceptions are thrown. If `catch_errors` is true, exceptions thrown by the callback will be caught and processing will continue (though the item is not marked as done). May be used as a decorator.

### HTTP API ###

* `GET /dbname?count=1&time=10.0` - Attempt, for about 2 seconds, to find `count` unlocked items (defaulting to 1) within the underlying CouchDB database `dbname`, and lock them for `time` seconds (defaulting to 10). May return less than the requested count, or none at all, (or perhaps even a few more than requested) but always sends back a JSON data structure like `{"items":[{"ticket":auto_generated, "value":posted_item_value}, ...] `. Items will be returned roughly in ascending order by ID, however due to parallel processing and the potential for lock timeouts, no strict order is guaranteed. Status code is 200 on success (even if no items were found in time).
* `POST /dbname?id=unique_id` - Adds a task item to the CouchDB database `dbname`. The item's value should be sent as the body of the request. The `id` is required to avoid potential duplicates, and should be both unique and yield a decent sort order. (The Python client library autogenerates these something like "local_increment-uuid_as_base64" so that they will not conflict but be processed approximately in the order they were posted.) Status code is 201 on success.
* `PUT /dbname/item_name` - Sets a boolean task item to the JSON body sent. This will overwrite any current value, and if an existing item was already locked the owning process will get an (ignorable) error when it tries to delete the item. This method is useful for tasks that *should* get (re)processed if necessary, although naturally to avoid extra work it is beneficial to choose `item_name`s that sort so dependent tasks tend to be performed *after* any tasks that re-set them. Status code is 201 on success.
* `DELETE /dbname` - You should send verbatim the JSON ticket object retrieved alongside the item's value. Status code will be 200 on success, 409 if the item has changed since retrieved, and 404 if the item has already been processed by another task.

## RQMS Deficiencies ##

CouchDB's strengths are many, but RQMS plays mostly to its weaknesses:

* There is currently no bulk PUT/POST method through RQMS, which can slow submission of thousands of task items due to HTTP/connection overhead.
* In a balanced job system, most tasks will be fetched soon after being posted. So CouchDB's actually-really-store-things durability hurts performance, although it does allow clean, fast restarts when the host computer runs out of memory and just starts nuking processes. (Yeah, I'm talking about *you*, Linux...)
* Replication, one of CouchDB's cornerstone features, is not useful as it means jobs will be performed multiple times. (See also: the next deficiency.)
* Due to some internal issues related to the append-only nature of CouchDB's on-disk structure, deleted items slow down the \_all_docs query RQMS uses to fetch items. So instead, we use an obscure "purge" feature to completely forget the document's record. (Thanks to @rnewson for insight into this and other general \_all_docs advice.) This means that if you *are* replicating, the deletes will not be propagated, further exacerbating the problem of duplicate item processing. In short: replication and RQMS don't mix.
* Speaking of \_all_docs...yeah...the queue proxy just queries that until it finds unlocked items. On every GET. This is one of the chief inefficiencies in RQMS. The "correct" solution would be to define a view for unlocked items, but this would mean more writes of transient data to and from disk. (This could be optimized if we are willing to assume that only one Q.node.js process will be accessing the database at once, which is probably reasonable.)

In practice, RQMS still performs reasonably well for hundreds (if not thousands) of tasks per minute across dozens of worker processes, with latency typically less than 2 seconds. Not exactly realtime, but good enough for many local, internal use cases.