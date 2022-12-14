---
'@apollo/datasource-rest': major
---

We now write to the shared HTTP-header-sensitive cache in the background rather than before the fetch resolves. By default, errors talking to the cache are logged with `console.log`; override `catchCacheWritePromiseErrors` to customize. If you call `fetch()`, the result object has a `cacheWritePromise` field that you can `await` if you want to know when the cache write ends.
