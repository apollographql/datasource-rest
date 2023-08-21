---
'@apollo/datasource-rest': minor
---

Add `url` parameter to `didEncounterErrors` hook

In previous versions of `RESTDataSource`, the URL of the request was available on the `Request` object passed in to the hook. The `Request` object is no longer passed as an argument, so this restores the availability of the `url` to the hook.
