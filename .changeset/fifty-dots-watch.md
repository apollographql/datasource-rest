---
'@apollo/datasource-rest': major
---

Update default `cacheKeyFor` to include method

In its previous form, `cacheKeyFor` only used the URL to calculate the cache
key. As a result, when `cacheOptions.ttl` was specified, the method was ignored.
This could lead to surprising behavior where a POST request's response was cached
and returned for a GET request (for example).

The default `cacheKeyFor` now includes the request method, meaning there will
now be distinct cache entries for a given URL per method.
