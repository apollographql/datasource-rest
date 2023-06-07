---
'@apollo/datasource-rest': patch
---

Fix bug in Cloudflare Worker usage where we try to call the `.raw()` method on its response headers object when it doesn't exist.

For some reason, the Cloudflare Worker's global `fetch` `HeadersList` object is passing the instanceof check against `node-fetch`'s `Headers` class, but it doesn't have the `.raw()` method we expect on it. To be sure, we can just make sure it's there before we call it.
