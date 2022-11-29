---
'@apollo/datasource-rest': major
---

Instead of memoizing GET requests forever in memory, only apply de-duplication during the lifetime of the original request. Replace the `memoizeGetRequests` field with a `requestDeduplicationPolicyFor()` method to determine how de-duplication works per request.

To restore the surprising infinite-unconditional-cache behavior of previous versions, use this implementation of `requestDeduplicationPolicyFor()` (which replaces `deduplicate-during-request-lifetime` with `deduplicate-until-invalidated`):

```ts
override protected requestDeduplicationPolicyFor(
  url: URL,
  request: RequestOptions,
): RequestDeduplicationPolicy {
  const cacheKey = this.cacheKeyFor(url, request);
  if (request.method === 'GET') {
    return {
      policy: 'deduplicate-until-invalidated',
      deduplicationKey: `${request.method} ${cacheKey}`,
    };
  } else {
    return {
      policy: 'do-not-deduplicate',
      invalidateDeduplicationKeys: [`GET ${cacheKey}`],
    };
  }
}
```

To restore the behavior of `memoizeGetRequests = false`, use this implementation of `requestDeduplicationPolicyFor()`:

```ts
protected override requestDeduplicationPolicyFor() {
  return { policy: 'do-not-deduplicate' } as const;
}
```
