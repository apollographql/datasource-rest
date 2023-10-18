---
'@apollo/datasource-rest': patch
---

* Fix RequestOptions.cacheOptions function return type to also return a non-promise value.
* Fix propagation of the cache options generic type `RequestOptions` and `AugmentedRequest`.
