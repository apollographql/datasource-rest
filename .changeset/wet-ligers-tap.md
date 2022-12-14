---
'@apollo/datasource-rest': minor
---

Add public `fetch` method

Users previously had no well-defined way to access the complete response (i.e. for header inspection). The public API of HTTP helper methods only returned the parsed response body. A `didReceiveResponse` hook existed as an attempt to solve this, but its semantics weren't well-defined, nor was it a type safe approach to solving the problem.

The new `fetch` method allows users to "bypass" the convenience of the HTTP helpers in order to construct their own full request and inspect the complete response themselves.

The `DataSourceFetchResult` type returned by this method also contains other useful information, like a `requestDeduplication` field containing the request's deduplication policy and whether it was deduplicated against a previous request.
