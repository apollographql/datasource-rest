---
'@apollo/datasource-rest': patch
---

Add `shouldCloneParsedBodyForDeduplication()` so subclasses can skip per-caller cloning under high-fanout request deduplication. The default still clones concurrent consumers for isolation, and still skips the clone when a request-lifetime GET has only one consumer.
