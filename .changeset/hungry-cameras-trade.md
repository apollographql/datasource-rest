---
'@apollo/datasource-rest': major
---

Instead of memoizing GET requests forever in memory, only apply de-duplication during the lifetime of the original request. Replace the `memoizeGetRequests` field with a `deduplicationPolicyFor()` method to determine how de-duplication works per request.

To restore the surprising infinite-unconditional-cache behavior of previous versions, use this implementation of `deduplicationPolicyFor()` (which replaces `deduplicate-during-request-lifetime` with `deduplicate-until-invalidated`):

```ts
override protected deduplicationPolicyFor(
  url: URL,
  request: RequestOptions,
): DeduplicationPolicy {
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

To restore the behavior of `memoizeGetRequests = false`, use this implementation of `deduplicationPolicyFor()`:

```ts
protected override deduplicationPolicyFor() {
  return { policy: 'do-not-deduplicate' } as const;
}
```
