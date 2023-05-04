---
'@apollo/datasource-rest': major
---

Drop Node v14 support

To take this major version, the only change necessary is to ensure your node runtime is using version 16.14.0 or later.

Node v14 is EOL, so we should drop support for it and upgrade packages and testing accordingly. Note this package has a dependency on `@apollo/utils.keyvaluecache` which requires specifically node@>=16.14 due to its dependency on `lru-cache`.
