---
'@apollo/datasource-rest': major
---

This change restores the full functionality of `willSendRequest` which
previously existed in the v3 version of this package. The v4 change introduced a
regression where the incoming request's `body` was no longer included in the
object passed to the `willSendRequest` hook, it was always `undefined`.

For consistency and typings reasons, the `path` argument is now the first
argument to the `willSendRequest` hook, followed by the `AugmentedRequest`
request object.