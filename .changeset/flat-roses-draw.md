---
'@apollo/datasource-rest': patch
---

The fetch Response now consistently has a non-empty `url` property; previously, `url` was an empty string if the response was read from the HTTP cache.
