---
'@apollo/datasource-rest': minor
---

If your provided `cache` is created with `PrefixingKeyValueCache.cacheDangerouslyDoesNotNeedPrefixesForIsolation` (new in `@apollo/utils.keyvaluecache@2.1.0`), the `httpcache:` prefix will not be added to cache keys.
