---
'@apollo/datasource-rest': patch
---

When de-duplicating requests, the returned parsed body is now cloned rather than shared across duplicate requests. If you override the `parseBody` method, you should also override `cloneParsedBody` to match.
