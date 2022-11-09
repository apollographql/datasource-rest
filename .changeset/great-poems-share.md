---
'@apollo/datasource-rest': major
---

When passing `params` as an object, parameters with `undefined` values are now skipped, like with `JSON.stringify`. So you can write:

```ts
getPost(query: string | undefined) {
  return this.get('post', { params: { query } });
}
```

and if `query` is not provided, the `query` parameter will be left off of the URL instead of given the value `undefined`.

As part of this change, we've removed the ability to provide `params` in formats other than this kind of object or as an `URLSearchParams` object. Previously, we allowed every form of input that could be passed to `new URLSearchParams()`. If you were using one of the other forms (like a pre-serialized URL string or an array of two-element arrays), just pass it directly to `new URLSearchParams`; note that the feature of stripping `undefined` values will not occur in this case. For example, you can replace `this.get('post', { params: [['query', query]] })` with `this.get('post', { params: new URLSearchParams([['query', query]]) })`. (`URLSearchParams` is available in Node as a global.)
