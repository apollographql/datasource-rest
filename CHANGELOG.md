# @apollo/datasource-rest

## 5.0.2

### Patch Changes

- [#159](https://github.com/apollographql/datasource-rest/pull/159) [`ee018a7`](https://github.com/apollographql/datasource-rest/commit/ee018a7744a8c6ea7f312eec33f1b99c4ae964d9) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Update `http-cache-semantics` package to latest patch, resolving a security
  issue.

  Unlike many security updates Apollo repos receive, this is an _actual_ (non-dev)
  dependency of this package which means it is actually a user-facing security
  issue.

  The potential impact of this issue is limited to a DOS attack (via an
  inefficient regex).

  This security issue would only affect you if either:

  - you pass untrusted (i.e. from your users) `cache-control` request headers
  - you sending requests to untrusted REST server that might return malicious
    `cache-control` headers

  Since `http-cache-semantics` is a careted (^) dependency in this package, the
  security issue can (and might already) be resolved via a `package-lock.json`
  update within your project (possibly triggered by `npm audit` or another
  dependency update which has already updated its version of the package in
  question). If `npm ls http-cache-semantics` reveals a tree of dependencies which
  only include the `4.1.1` version (and no references to any previous versions)
  then you are currently unaffected and this patch should have (for all intents
  and purpose) no effect.

  More details available here: https://github.com/advisories/GHSA-rc47-6667-2j5j

- [#160](https://github.com/apollographql/datasource-rest/pull/160) [`786c44f`](https://github.com/apollographql/datasource-rest/commit/786c44f9fbb5aef43962fc39bb74baa870fdb8ec) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Add missing `@apollo/utils.withrequired` type dependency which is part of the
  public typings (via the `AugmentedRequest` type).

- [#154](https://github.com/apollographql/datasource-rest/pull/154) [`bb0cff0`](https://github.com/apollographql/datasource-rest/commit/bb0cff0e1cb9e8adb13587fc9d99ea573be4cc32) Thanks [@JustinSomers](https://github.com/JustinSomers)! - Addresses duplicate content-type header bug due to upper-cased headers being forwarded. This change instead maps all headers to lowercased headers.

## 5.0.1

### Patch Changes

- [#137](https://github.com/apollographql/datasource-rest/pull/137) [`c9ffa7f`](https://github.com/apollographql/datasource-rest/commit/c9ffa7f0de166f619eeed151d7a9b129aa917d59) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Create intermediate request types (`PostRequest`, etc.) for consistency and export them.
  Export `DataSourceRequest`, `DataSourceConfig`, and `DataSourceFetchResult` types.

## 5.0.0

Version 5 of `RESTDataSource` addresses many of the long-standing issues and PRs that have existed in this repository (and its former location in the `apollo-server` repository). While this version does include a number of breaking changes, our hope is that the updated API makes this package more usable and its caching-related behavior less surprising.

The entries below enumerate all of the changes in v5 in detail along with their associated PRs. If you are migrating from v3 or v4, we recommend at least skimming the entries below to see if you're affected by the breaking changes. As always, we recommend using TypeScript with our libraries. This will be especially helpful in surfacing changes to the API which affect your usage. Even if you don't use TypeScript, you can still benefit from the typings we provide using various convenience tools like `// @ts-check` (with compatible editors like VS Code).

### TL;DR

At a higher level, the most notable changes include:

#### Breaking

- Remove magic around request deduplication behavior and provide a hook to configure its behavior. Previously, requests were deduplicated forever by default. Now, only requests happening concurrently will be deduplicated (and subsequently cleared from the in-memory cache).
- Cache keys now include the request method by default (no more overlap in GET and POST requests).
- Remove the semantically confusing `didReceiveResponse` hook.
- Paths now behave as links would in a web browser, allowing path segments to contain colons.

#### Additive

- Introduce a public `fetch` method, giving access to the full `Response` object
- Improve ETag header semantics (correctly handle `Last-Modified` header)
- Introduce a public `head` class method for issuing `HEAD` requests

### Major Changes

- [#100](https://github.com/apollographql/datasource-rest/pull/100) [`2e51657`](https://github.com/apollographql/datasource-rest/commit/2e51657b4f7d646f82f8e03039c339f59a5260af) Thanks [@glasser](https://github.com/glasser)! - Instead of memoizing GET requests forever in memory, only apply de-duplication during the lifetime of the original request. Replace the `memoizeGetRequests` field with a `requestDeduplicationPolicyFor()` method to determine how de-duplication works per request.

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

- [#89](https://github.com/apollographql/datasource-rest/pull/89) [`4a249ec`](https://github.com/apollographql/datasource-rest/commit/4a249ec48e7d32a564ff7805af4435d76dc9cab1) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - This change restores the full functionality of `willSendRequest` which
  previously existed in the v3 version of this package. The v4 change introduced a
  regression where the incoming request's `body` was no longer included in the
  object passed to the `willSendRequest` hook, it was always `undefined`.

  For consistency and typings reasons, the `path` argument is now the first
  argument to the `willSendRequest` hook, followed by the `AugmentedRequest`
  request object.

- [#115](https://github.com/apollographql/datasource-rest/pull/115) [`be4371f`](https://github.com/apollographql/datasource-rest/commit/be4371f5f5582f980f55c3cfac4d8bc58dce8242) Thanks [@glasser](https://github.com/glasser)! - The `errorFromResponse` method now receives an options object with `url`, `request`, `response`, and `parsedBody` rather than just a response, and the body has already been parsed.

- [#110](https://github.com/apollographql/datasource-rest/pull/110) [`ea43a27`](https://github.com/apollographql/datasource-rest/commit/ea43a272f1aeaa511d57d4a84290c64d2b63785c) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Update default `cacheKeyFor` to include method

  In its previous form, `cacheKeyFor` only used the URL to calculate the cache key. As a result, when `cacheOptions.ttl` was specified, the method was ignored. This could lead to surprising behavior where a POST request's response was cached and returned for a GET request (for example).

  The default `cacheKeyFor` now includes the request method, meaning there will now be distinct cache entries for a given URL per method.

- [#88](https://github.com/apollographql/datasource-rest/pull/88) [`2c3dbd0`](https://github.com/apollographql/datasource-rest/commit/2c3dbd0cb0d6de7b414a6f73718541280903d093) Thanks [@glasser](https://github.com/glasser)! - When passing `params` as an object, parameters with `undefined` values are now skipped, like with `JSON.stringify`. So you can write:

  ```ts
  getUser(query: string | undefined) {
    return this.get('user', { params: { query } });
  }
  ```

  and if `query` is not provided, the `query` parameter will be left off of the URL instead of given the value `undefined`.

  As part of this change, we've removed the ability to provide `params` in formats other than this kind of object or as an `URLSearchParams` object. Previously, we allowed every form of input that could be passed to `new URLSearchParams()`. If you were using one of the other forms (like a pre-serialized URL string or an array of two-element arrays), just pass it directly to `new URLSearchParams`; note that the feature of stripping `undefined` values will not occur in this case. For example, you can replace `this.get('user', { params: [['query', query]] })` with `this.get('user', { params: new URLSearchParams([['query', query]]) })`. (`URLSearchParams` is available in Node as a global.)

- [#107](https://github.com/apollographql/datasource-rest/pull/107) [`4b2a6f9`](https://github.com/apollographql/datasource-rest/commit/4b2a6f94eb905a08669e23d0a37f2a52d6ea055c) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Remove `didReceiveResponse` hook

  The naming of this hook is deceiving; if this hook is overridden it becomes
  responsible for returning the parsed body and handling errors if they occur. It
  was originally introduced in
  https://github.com/apollographql/apollo-server/issues/1324, where the author
  implemented it due to lack of access to the complete response (headers) in the
  fetch methods (get, post, ...). This approach isn't a type safe way to
  accomplish this and places the burden of body parsing and error handling on the
  user.

  Removing this hook is a prerequisite to a subsequent change that will introduce
  the ability to fetch a complete response (headers included) aside from the
  provided fetch methods which only return a body. This change will reinstate the
  functionality that the author of this hook had originally intended in a more
  direct manner.

  You reasonably may have used this hook for things like observability and logging,
  updating response headers, or mutating the response object in some other way. If
  so, you can now override the public `fetch` method like so:

  ```ts
  class MyDataSource extends RESTDataSource {
    override async fetch<TResult>(
      path: string,
      incomingRequest: DataSourceRequest = {},
    ) {
      const result = await super.fetch(path, incomingRequest);
      // Log or update here; you have access to `result.parsedBody` and `result.response`.
      // Return the `result` object when you're finished.
      return result;
    }
  }
  ```

  All of the convenience http methods (`get()`, `post()`, etc.) call this `fetch` function, so
  changes here will apply to every request that your datasource makes.

- [#95](https://github.com/apollographql/datasource-rest/pull/95) [`c59b82f`](https://github.com/apollographql/datasource-rest/commit/c59b82fd7bfd90cac59fe10d65b3aa23658354c1) Thanks [@glasser](https://github.com/glasser)! - Simplify interpretation of `this.baseURL` so it works exactly like links in a web browser.

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

- [#121](https://github.com/apollographql/datasource-rest/pull/121) [`32f8f04`](https://github.com/apollographql/datasource-rest/commit/32f8f04dc30acf0af7a32ddffdf3170aa76c8db1) Thanks [@glasser](https://github.com/glasser)! - We now write to the shared HTTP-header-sensitive cache in the background rather than before the fetch resolves. By default, errors talking to the cache are logged with `console.log`; override `catchCacheWritePromiseErrors` to customize. If you call `fetch()`, the result object has a `httpCache.cacheWritePromise` field that you can `await` if you want to know when the cache write ends.

### Minor Changes

- [#117](https://github.com/apollographql/datasource-rest/pull/117) [`0f94ad9`](https://github.com/apollographql/datasource-rest/commit/0f94ad9f3cfed2a18dd304e730475a1803c358ba) Thanks [@renovate](https://github.com/apps/renovate)! - If your provided `cache` is created with `PrefixingKeyValueCache.cacheDangerouslyDoesNotNeedPrefixesForIsolation` (new in `@apollo/utils.keyvaluecache@2.1.0`), the `httpcache:` prefix will not be added to cache keys.

- [#114](https://github.com/apollographql/datasource-rest/pull/114) [`6ebc093`](https://github.com/apollographql/datasource-rest/commit/6ebc09366a12a6ecd45a1d5388074cac330e12cd) Thanks [@glasser](https://github.com/glasser)! - Allow specifying the cache key directly as a `cacheKey` option in the request options. This is read by the default implementation of `cacheKeyFor` (which is still called).

- [#106](https://github.com/apollographql/datasource-rest/pull/106) [`4cbfd36`](https://github.com/apollographql/datasource-rest/commit/4cbfd36801d9848e772cdc93051a7e5721761119) Thanks [@glasser](https://github.com/glasser)! - Previously, RESTDataSource doubled the TTL used with its shared header-sensitive cache when it may be able to use the cache entry after it goes stale because it contained the `ETag` header; for these cache entries, RESTDataSource can set the `If-None-Match` header when sending the REST request and the server can return a 304 response telling RESTDataSource to reuse the old response from its cache. Now, RESTDataSource also extends the TTL for responses with the `Last-Modified` header (which it can validate with `If-Modified-Since`).

- [#110](https://github.com/apollographql/datasource-rest/pull/110) [`ea43a27`](https://github.com/apollographql/datasource-rest/commit/ea43a272f1aeaa511d57d4a84290c64d2b63785c) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Provide head() HTTP helper method

  Some REST APIs make use of HEAD requests. It seems reasonable for us to provide this method as we do the others.

  It's worth noting that the API differs from the other helpers. While bodies are expected/allowed for other requests, that is explicitly not the case for HEAD requests. This method returns the request object itself rather than a parsed body so that useful information can be extracted from the headers.

- [#114](https://github.com/apollographql/datasource-rest/pull/114) [`6ebc093`](https://github.com/apollographql/datasource-rest/commit/6ebc09366a12a6ecd45a1d5388074cac330e12cd) Thanks [@glasser](https://github.com/glasser)! - Allow specifying the options passed to `new CachePolicy()` via a `httpCacheSemanticsCachePolicyOptions` option in the request options.

- [#121](https://github.com/apollographql/datasource-rest/pull/121) [`32f8f04`](https://github.com/apollographql/datasource-rest/commit/32f8f04dc30acf0af7a32ddffdf3170aa76c8db1) Thanks [@glasser](https://github.com/glasser)! - If you're using `node-fetch` as your Fetcher implementation (the default) and the response has header names that appear multiple times (such as `Set-Cookie`), then you can use the `node-fetch`-specific API `(await myRestDataSource.fetch(url)).response.headers.raw()` to see the multiple header values separately.

- [#115](https://github.com/apollographql/datasource-rest/pull/115) [`be4371f`](https://github.com/apollographql/datasource-rest/commit/be4371f5f5582f980f55c3cfac4d8bc58dce8242) Thanks [@glasser](https://github.com/glasser)! - New `throwIfResponseIsError` hook allows you to control whether a response should be returned or thrown as an error. Partially replaces the removed `didReceiveResponse` hook.

- [#116](https://github.com/apollographql/datasource-rest/pull/116) [`ac767a7`](https://github.com/apollographql/datasource-rest/commit/ac767a79a6bb6911703f04849b33553e3a872fef) Thanks [@glasser](https://github.com/glasser)! - The `cacheOptions` function and `cacheOptionsFor` method may now optionally be async.

- [#90](https://github.com/apollographql/datasource-rest/pull/90) [`b66da37`](https://github.com/apollographql/datasource-rest/commit/b66da37775d831ccb8de9dccd696e5731f734ca0) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Add a new overridable method `shouldJSONSerializeBody` for customizing body serialization behavior. This method should return a `boolean` in order to inform RESTDataSource as to whether or not it should call `JSON.stringify` on the request body.

- [#110](https://github.com/apollographql/datasource-rest/pull/110) [`ea43a27`](https://github.com/apollographql/datasource-rest/commit/ea43a272f1aeaa511d57d4a84290c64d2b63785c) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Add public `fetch` method

  Users previously had no well-defined way to access the complete response (i.e. for header inspection). The public API of HTTP helper methods only returned the parsed response body. A `didReceiveResponse` hook existed as an attempt to solve this, but its semantics weren't well-defined, nor was it a type safe approach to solving the problem.

  The new `fetch` method allows users to "bypass" the convenience of the HTTP helpers in order to construct their own full request and inspect the complete response themselves.

  The `DataSourceFetchResult` type returned by this method also contains other useful information, like a `requestDeduplication` field containing the request's deduplication policy and whether it was deduplicated against a previous request.

### Patch Changes

- [#121](https://github.com/apollographql/datasource-rest/pull/121) [`609ba1f`](https://github.com/apollographql/datasource-rest/commit/609ba1fc03fd1581176d41a1f666436db37acd0c) Thanks [@glasser](https://github.com/glasser)! - When de-duplicating requests, the returned parsed body is now cloned rather than shared across duplicate requests. If you override the `parseBody` method, you should also override `cloneParsedBody` to match.

- [#105](https://github.com/apollographql/datasource-rest/pull/105) [`8af22fe`](https://github.com/apollographql/datasource-rest/commit/8af22fe02edf5b1ac776bbb85029cb7399f0c604) Thanks [@glasser](https://github.com/glasser)! - The fetch Response now consistently has a non-empty `url` property; previously, `url` was an empty string if the response was read from the HTTP cache.

- [#90](https://github.com/apollographql/datasource-rest/pull/90) [`b66da37`](https://github.com/apollographql/datasource-rest/commit/b66da37775d831ccb8de9dccd696e5731f734ca0) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Correctly identify and serialize all plain objects (like those with a null prototype)

- [#94](https://github.com/apollographql/datasource-rest/pull/94) [`834401d`](https://github.com/apollographql/datasource-rest/commit/834401ddcec46f54c2b15a67729dde0d8ab252e1) Thanks [@renovate](https://github.com/apps/renovate)! - Update `@apollo/utils.fetcher` dependency to v2.0.0

- [#89](https://github.com/apollographql/datasource-rest/pull/89) [`4a249ec`](https://github.com/apollographql/datasource-rest/commit/4a249ec48e7d32a564ff7805af4435d76dc9cab1) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - `string` and `Buffer` bodies are now correctly included on the outgoing request.
  Due to a regression in v4, they were ignored and never sent as the `body`.
  `string` and `Buffer` bodies are now passed through to the outgoing request
  (without being JSON stringified).

## 4.3.2

### Patch Changes

- [#57](https://github.com/apollographql/datasource-rest/pull/57) [`946d79e`](https://github.com/apollographql/datasource-rest/commit/946d79e07918858918403c81efd1f8dff9dec028) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Fix build process (again), ensure built directory exists before publish

## 4.3.1

### Patch Changes

- [#54](https://github.com/apollographql/datasource-rest/pull/54) [`aa0fa97`](https://github.com/apollographql/datasource-rest/commit/aa0fa97eb50762e5410c7c6f2a3d2bc6c4f1f956) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Fix installation into non-TS repositories

## 4.3.0

### Minor Changes

- [#13](https://github.com/apollographql/datasource-rest/pull/13) [`adb7e81`](https://github.com/apollographql/datasource-rest/commit/adb7e81159bd99b40b1bdee273d0c9fe35547113) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Official Apollo Server v4.0.0 support

## 4.2.0

### Minor Changes

- [#5](https://github.com/apollographql/datasource-rest/pull/5) [`1857515`](https://github.com/apollographql/datasource-rest/commit/1857515dfe4971c71770cb52b5b5cfb368059107) Thanks [@smyrick](https://github.com/smyrick)! - Rename `requestCacheEnabled` to `memoizeGetRequests`. Acknowledging this is
  actually a breaking change, but this package has been live for a weekend with
  nothing recommending its usage yet.

## 4.1.0

### Minor Changes

- [#3](https://github.com/apollographql/datasource-rest/pull/3) [`d2e600c`](https://github.com/apollographql/datasource-rest/commit/d2e600c76838ab70bef311eaa458f4856d1ecc48) Thanks [@smyrick](https://github.com/smyrick)! - Add option to disable GET request cache

## 4.0.0

### Major Changes

- [#1](https://github.com/apollographql/datasource-rest/pull/1) [`55b6b10`](https://github.com/apollographql/datasource-rest/commit/55b6b10f12498e63ced75ce61bab25e55f7eb79e) Thanks [@trevor-scheer](https://github.com/trevor-scheer)! - Initial release
