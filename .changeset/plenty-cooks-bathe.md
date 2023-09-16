---
'@apollo/datasource-rest': minor
---

Added support to the RESTDatasource to be able to specify a custom cache set options type. The cache set options may need to be customized to include additional set options supported by the underlying key value cache implementation.

For example, if the [InMemoryLRUCache](https://github.com/apollographql/apollo-utils/blob/main/packages/keyValueCache/src/InMemoryLRUCache.ts) is being used to cache HTTP responses, then `noDisposeOnSet`, `noUpdateTTL`, etc cache options can be provided to the LRU cache:

```typescript
import { InMemoryLRUCache } from '@apollo/utils.keyvaluecache';

interface CustomCacheOptions {
  ttl?: number;
  noDisposeOnSet?: boolean;
}

class ExampleDataSource extends RESTDataSource<CustomCacheOptions> {
  override baseURL = 'https://api.example.com';

  constructor() {
    super({ cache: new InMemoryLRUCache() });
  }

  getData(id: number) {
    return this.get(`data/${id}`, {
      cacheOptions: { ttl: 3600, noDisposeOnSet: true },
    });
  }
}
```