---
'@apollo/datasource-rest': patch
---

`string` and `Buffer` bodies are now correctly included on the outgoing request.
Due to a regression in v4, they were ignored and never sent as the `body`.
`string` and `Buffer` bodies are now passed through to the outgoing request
(without being JSON stringified).
