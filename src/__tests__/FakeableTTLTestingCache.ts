// The default AS cache (`InMemoryLRUCache`) uses `lru-cache` internally, which
// we've had issues mocking timers for. Presumably this has something to do with
// the way that `lru-cache` grabs its `perf` function:
// https://github.com/isaacs/node-lru-cache/blob/118a078cc0ea3a17f7b2ff4caf04e6aa3a33b136/index.js#L1-L6
// This test suite already mocks `Date` (because
// `ApolloServerPluginResponseCache` uses it internally), so we used that for
// time calculation in this mock cache as well.
//
// (Borrowed from apollo-server.)
export class FakeableTTLTestingCache {
  constructor(
    private cache: Map<
      string,
      { value: string; deadline: number | null }
    > = new Map(),
  ) {}

  async get(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.deadline && entry.deadline <= Date.now()) {
      await this.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    { ttl }: { ttl: number | null } = { ttl: null },
  ) {
    this.cache.set(key, {
      value,
      deadline: ttl ? Date.now() + ttl * 1000 : null,
    });
  }

  async delete(key: string) {
    this.cache.delete(key);
  }

  isEmpty() {
    // Trigger the get()-time TTL cleanup.
    for (const key of this.cache.keys()) {
      this.get(key);
    }
    return this.cache.size === 0;
  }
}
