---
'@apollo/datasource-rest': minor
---

If you're using `node-fetch` as your Fetcher implementation (the default) and the response has header names that appear multiple times (such as `Set-Cookie`), then you can use the `node-fetch`-specific API `(await myRestDataSource.fetch(url)).response.headers.raw()` to see the multiple header values separately.
