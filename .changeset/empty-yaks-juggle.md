---
'@apollo/datasource-rest': major
---

The `errorFromResponse` method now receives an options object with `url`, `request`, `response`, and `parsedBody` rather than just a response, and the body has already been parsed.
