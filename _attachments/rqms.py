'''Python client library for RQMS'''

import httplib
from urlparse import urlparse
import json
from collections import deque
from time import sleep

class Queue(object):
    '''Simple wrapper to fetch jobs from RQMS server via a URL like http://localhost:7085/tasks'''
    
    def __init__(self, url, time=30.0, batch_size=1):
        self.url = url
        self.url_parts = urlparse(url)
        self.time = time
        self.batch_size = batch_size
        self._batch = deque()
    
    def _conn(self):
        Con = httplib.HTTPSConnection if self.url_parts.scheme == 'https' else httplib.HTTPConnection
        return Con(self.url_parts.netloc)
    
    def put(self, item):
        c = self._conn()
        c.request('POST', self.url, json.dumps(item), {'Content-Type':"application/json"})
        resp = c.getresponse()
        if resp.status != 201:
            raise IOError("Failed to post item")
    
    class _DequeuedItem(dict):
        def __init__(self, server_item):
            self.ticket = server_item['ticket']
            self.update(server_item['value'])
    
    def get(self):
        while not len(self._batch):
            c = self._conn()
            c.request('GET', self.url + "?count=%u&time=%f" % (self.batch_size, self.time))
            resp = c.getresponse()
            if resp.status != 200:
                raise IOError("Failed to get items")
            for item in json.loads(resp.read())['items']:
                self._batch.append(self._DequeuedItem(item))
            if not len(self._batch):
                sleep(1.0)
        return self._batch.popleft()
    
    def task_done(self, item):
        c = self._conn()
        c.request('DELETE', self.url, item.ticket, {'Content-Type':"application/json"})
        resp = c.getresponse()
        if resp.status == 409:
            raise AssertionError("Job performed multiple times")
        elif resp.status != 200:
            raise IOError("Failed to remove item")
