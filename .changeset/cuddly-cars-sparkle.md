---
'@apollo/datasource-rest': patch
---

The v4 update introduced multiple regressions w.r.t. the intermediary `modifiedRequest` object that was added.

1. The `body` was no longer being added to the intermediary request object before calling `willSendRequest`
2. `modifiedRequest.body` was never being set in the case that the incoming body was a `string` or `Buffer`

This change resolves both by reverting to what we previously had in v3 (preserving the properties on the incoming request object). The types have been updated accordingly.
