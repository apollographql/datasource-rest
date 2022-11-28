---
'@apollo/datasource-rest': major
---

Simplify interpretation of `this.baseURL` so it works exactly like links in a web browser.

If you set `this.baseURL` to an URL with a non-empty path component, this may change the URL that your methods talk to. Specifically:

- Paths passed to methods such as `this.get('/foo')` now _replace_ the entire URL path from `this.baseURL`. If you did not intend this, write `this.get('foo')` instead.
- If `this.baseURL` has a non-empty path and does not end in a trailing slash, paths such as `this.get('foo')` will _replace_ the last component of the URL path instead of adding a new component. If you did not intend this, add a trailing slash to `this.baseURL`.

If you preferred the v4 semantics and do not want to make the changes described above, you can restore v4 semantics by overriding `resolveURL` in your subclass with the following code from v4:

```ts
override resolveURL(path: string): ValueOrPromise<URL> {
  if (path.startsWith('/')) {
    path = path.slice(1);
  }
  const baseURL = this.baseURL;
  if (baseURL) {
    const normalizedBaseURL = baseURL.endsWith('/')
      ? baseURL
      : baseURL.concat('/');
    return new URL(path, normalizedBaseURL);
  } else {
    return new URL(path);
  }
}
```

As part of this change, it is now possible to specify URLs whose first path segment contains a colon, such as `this.get('/foo:bar')`.
