---
'@apollo/datasource-rest': minor
---

Add optional `url` parameter to `didEncounterErrors` hook

In previous versions of `RESTDataSource`, the URL of the request was available on the `Request` object passed in to the hook. The `Request` object is no longer passed as an argument, so this restores the availability of the `url` to the hook.

This is optional for now in order to keep this change forward compatible for existing `this.didEncounterErrors` callsites in userland code. In the next major version, this might become a required parameter.
