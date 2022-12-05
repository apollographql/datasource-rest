---
'@apollo/datasource-rest': minor
---

Previously, RESTDataSource doubled the TTL used with its shared header-sensitive cache when it may be able to use the cache entry after it goes stale because it contained the `ETag` header; for these cache entries, RESTDataSource can set the `If-None-Match` header when sending the REST request and the server can return a 304 response telling RESTDataSource to reuse the old response from its cache. Now, RESTDataSource also extends the TTL for responses with the `Last-Modified` header (which it can validate with `If-Modified-Since`).
