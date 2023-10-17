---
'@apollo/datasource-rest': patch
---

Use lodash's `cloneDeep` to clone parsed body instead of `JSON.parse(JSON.stringify(...))`
