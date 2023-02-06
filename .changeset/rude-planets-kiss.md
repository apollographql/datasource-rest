---
'@apollo/datasource-rest': patch
---

Addresses duplicate content-type header bug due to upper-cased headers being forwarded. This change instead maps all headers to lowercased headers.
