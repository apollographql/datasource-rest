import nodeFetch, {
  Response as NodeFetchResponse,
  Headers as NodeFetchHeaders,
  type HeadersInit as NodeFetchHeadersInit,
} from 'node-fetch';
import CachePolicy from 'http-cache-semantics';
import type { Options as HttpCacheSemanticsOptions } from 'http-cache-semantics';
import type {
  Fetcher,
  FetcherResponse,
  FetcherRequestInit,
} from '@apollo/utils.fetcher';
import {
  InMemoryLRUCache,
  KeyValueCache,
  PrefixingKeyValueCache,
} from '@apollo/utils.keyvaluecache';
import type {
  CacheOptions,
  RequestOptions,
  ValueOrPromise,
} from './RESTDataSource';

// We want to use a couple internal properties of CachePolicy. (We could get
// `_url` and `_status` off of the serialized CachePolicyObject, but `age()` is
// just missing from `@types/http-cache-semantics` for now.) So we just cast to
// this interface for now.
interface SneakyCachePolicy extends CachePolicy {
  _url: string | undefined;
  _status: number;
  age(): number;
}

interface ResponseWithCacheWritePromise {
  response: FetcherResponse;
  cacheWritePromise?: Promise<void>;
}

export class HTTPCache {
  private keyValueCache: KeyValueCache;
  private httpFetch: Fetcher;

  constructor(
    keyValueCache: KeyValueCache = new InMemoryLRUCache(),
    httpFetch: Fetcher = nodeFetch,
  ) {
    this.keyValueCache = new PrefixingKeyValueCache(
      keyValueCache,
      'httpcache:',
    );
    this.httpFetch = httpFetch;
  }

  async fetch(
    url: URL,
    requestOpts: FetcherRequestInit = {},
    cache?: {
      cacheKey?: string;
      cacheOptions?:
        | CacheOptions
        | ((
            url: string,
            response: FetcherResponse,
            request: RequestOptions,
          ) => ValueOrPromise<CacheOptions | undefined>);
      httpCacheSemanticsCachePolicyOptions?: HttpCacheSemanticsOptions;
    },
  ): Promise<ResponseWithCacheWritePromise> {
    const urlString = url.toString();
    requestOpts.method = requestOpts.method ?? 'GET';
    const cacheKey = cache?.cacheKey ?? urlString;

    // Bypass the cache altogether for HEAD requests. Caching them might be fine
    // to do, but for now this is just a pragmatic choice for timeliness without
    // fully understanding the interplay between GET and HEAD requests (i.e.
    // refreshing headers with HEAD requests, responding to HEADs with cached
    // and valid GETs, etc.)
    if (requestOpts.method === 'HEAD') {
      return { response: await this.httpFetch(urlString, requestOpts) };
    }

    const entry = await this.keyValueCache.get(cacheKey);
    if (!entry) {
      // There's nothing in our cache. Fetch the URL and save it to the cache if
      // we're allowed.
      const response = await this.httpFetch(urlString, requestOpts);

      const policy = new CachePolicy(
        policyRequestFrom(urlString, requestOpts),
        policyResponseFrom(response),
        cache?.httpCacheSemanticsCachePolicyOptions,
      ) as SneakyCachePolicy;

      return this.storeResponseAndReturnClone(
        urlString,
        response,
        requestOpts,
        policy,
        cacheKey,
        cache?.cacheOptions,
      );
    }

    const { policy: policyRaw, ttlOverride, body } = JSON.parse(entry);

    const policy = CachePolicy.fromObject(policyRaw) as SneakyCachePolicy;
    // Remove url from the policy, because otherwise it would never match a
    // request with a custom cache key (ie, we want users to be able to tell us
    // that two requests should be treated as the same even if the URL differs).
    const urlFromPolicy = policy._url;
    policy._url = undefined;

    if (
      (ttlOverride && policy.age() < ttlOverride) ||
      (!ttlOverride &&
        policy.satisfiesWithoutRevalidation(
          policyRequestFrom(urlString, requestOpts),
        ))
    ) {
      // Either the cache entry was created with an explicit TTL override (ie,
      // `ttl` returned from `cacheOptionsFor`) and we're within that TTL, or
      // the cache entry was not created with an explicit TTL override and the
      // header-based cache policy says we can safely use the cached response.
      const headers = policy.responseHeaders();
      return {
        response: new NodeFetchResponse(body, {
          url: urlFromPolicy,
          status: policy._status,
          headers: cachePolicyHeadersToNodeFetchHeadersInit(headers),
        }),
      };
    } else {
      // We aren't sure that we're allowed to use the cached response, so we are
      // going to actually do a fetch. However, we may have one extra trick up
      // our sleeve. If the cached response contained an `etag` or
      // `last-modified` header, then we can add an appropriate `if-none-match`
      // or `if-modified-since` header to the request. If what we're fetching
      // hasn't changed, then the server can return a small 304 response instead
      // of a large 200, and we can use the body from our cache. This logic is
      // implemented inside `policy.revalidationHeaders`; we support it by
      // setting a larger KeyValueCache TTL for responses with these headers
      // (see `canBeRevalidated`).  (If the cached response doesn't have those
      // headers, we'll just end up fetching the normal request here.)
      //
      // Note that even if we end up able to reuse the cached body here, we
      // still re-write to the cache, because we might need to update the TTL or
      // other aspects of the cache policy based on the headers we got back.
      const revalidationHeaders = policy.revalidationHeaders(
        policyRequestFrom(urlString, requestOpts),
      );
      const revalidationRequest: RequestOptions = {
        ...requestOpts,
        headers: cachePolicyHeadersToFetcherHeadersInit(revalidationHeaders),
      };
      const revalidationResponse = await this.httpFetch(
        urlString,
        revalidationRequest,
      );

      const { policy: revalidatedPolicy, modified } = policy.revalidatedPolicy(
        policyRequestFrom(urlString, revalidationRequest),
        policyResponseFrom(revalidationResponse),
      ) as unknown as { policy: SneakyCachePolicy; modified: boolean };

      return this.storeResponseAndReturnClone(
        urlString,
        new NodeFetchResponse(
          modified ? await revalidationResponse.text() : body,
          {
            url: revalidatedPolicy._url,
            status: revalidatedPolicy._status,
            headers: cachePolicyHeadersToNodeFetchHeadersInit(
              revalidatedPolicy.responseHeaders(),
            ),
          },
        ),
        requestOpts,
        revalidatedPolicy,
        cacheKey,
        cache?.cacheOptions,
      );
    }
  }

  private async storeResponseAndReturnClone(
    url: string,
    response: FetcherResponse,
    request: RequestOptions,
    policy: SneakyCachePolicy,
    cacheKey: string,
    cacheOptions?:
      | CacheOptions
      | ((
          url: string,
          response: FetcherResponse,
          request: RequestOptions,
        ) => ValueOrPromise<CacheOptions | undefined>),
  ): Promise<ResponseWithCacheWritePromise> {
    if (typeof cacheOptions === 'function') {
      cacheOptions = await cacheOptions(url, response, request);
    }

    let ttlOverride = cacheOptions?.ttl;

    if (
      // With a TTL override, only cache successful responses but otherwise ignore method and response headers
      !(ttlOverride && policy._status >= 200 && policy._status <= 299) &&
      // Without an override, we only cache GET requests and respect standard HTTP cache semantics
      !(request.method === 'GET' && policy.storable())
    ) {
      return { response };
    }

    let ttl =
      ttlOverride === undefined
        ? Math.round(policy.timeToLive() / 1000)
        : ttlOverride;
    if (ttl <= 0) return { response };

    // If a response can be revalidated, we don't want to remove it from the
    // cache right after it expires. (See the comment above the call to
    // `revalidationHeaders` for details.) We may be able to use better
    // heuristics here, but for now we'll take the max-age times 2.
    if (canBeRevalidated(response)) {
      ttl *= 2;
    }

    // Clone the response and return it. In the background, read the original
    // response and write it to the cache. The caller is responsible for
    // `await`ing or `catch`ing `cacheWritePromise`. (By default, RESTDataSource
    // `catch`es it with `console.log`.)
    //
    // When you clone a response, you're generally expected (at least by
    // node-fetch: https://github.com/node-fetch/node-fetch/issues/151) to read
    // both bodies in parallel; if you only read one of them and ignore the
    // other, the one you're reading might start blocking once the second one's
    // buffer fills. We don't think this is a real problem here: we do
    // immediately read from the one we're writing to the cache, and if the
    // caller doesn't bother to read its response, the only real downside is
    // that we won't ever write to the cache, which seems maybe OK for an
    // "ignored" body. (It could perhaps lead to a memory leak, but the answer
    // there is to make sure your parseBody override does consume the response.)
    const returnedResponse = response.clone();
    return {
      response: returnedResponse,
      cacheWritePromise: this.readResponseAndWriteToCache({
        response,
        policy,
        ttl,
        ttlOverride,
        cacheKey,
      }),
    };
  }

  private async readResponseAndWriteToCache({
    response,
    policy,
    ttl,
    ttlOverride,
    cacheKey,
  }: {
    response: FetcherResponse;
    policy: CachePolicy;
    ttl: number | null | undefined;
    ttlOverride: number | undefined;
    cacheKey: string;
  }): Promise<void> {
    const body = await response.text();
    const entry = JSON.stringify({
      policy: policy.toObject(),
      ttlOverride,
      body,
    });

    await this.keyValueCache.set(cacheKey, entry, {
      ttl,
    });
  }
}

function canBeRevalidated(response: FetcherResponse): boolean {
  return response.headers.has('ETag') || response.headers.has('Last-Modified');
}

function policyRequestFrom(url: string, request: RequestOptions) {
  return {
    url,
    method: request.method ?? 'GET',
    headers: request.headers ?? {},
  };
}

function policyResponseFrom(response: FetcherResponse) {
  return {
    status: response.status,
    headers:
      response.headers instanceof NodeFetchHeaders
        ? nodeFetchHeadersToCachePolicyHeaders(response.headers)
        : Object.fromEntries(response.headers),
  };
}

// In the special case that these headers come from node-fetch, uses
// node-fetch's `raw()` method (which returns a `Record<string, string[]>`) to
// create our CachePolicy.Headers. Note that while we could theoretically just
// return `headers.raw()` here (it does match the typing of
// CachePolicy.Headers), `http-cache-semantics` sadly does expect most of the
// headers it pays attention to to only show up once (see eg
// https://github.com/kornelski/http-cache-semantics/issues/28). We want to
// preserve the multiplicity of other headers that CachePolicy doesn't parse
// (like set-cookie) because we store the CachePolicy in the cache, but not the
// interesting ones that we hope were singletons, so this function
// de-singletonizes singleton response headers.
function nodeFetchHeadersToCachePolicyHeaders(
  headers: NodeFetchHeaders,
): CachePolicy.Headers {
  const cachePolicyHeaders = Object.create(null);
  for (const [name, values] of Object.entries(headers.raw())) {
    cachePolicyHeaders[name] = values.length === 1 ? values[0] : values;
  }
  return cachePolicyHeaders;
}

// CachePolicy.Headers can store header values as string or string-array (for
// duplicate headers). Convert it to "list of pairs", which is a valid
// `node-fetch` constructor argument and will preserve the separation of
// duplicate headers.
function cachePolicyHeadersToNodeFetchHeadersInit(
  headers: CachePolicy.Headers,
): NodeFetchHeadersInit {
  const headerList = [];
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      headerList.push([name, value]);
    } else if (value) {
      for (const subValue of value) {
        headerList.push([name, subValue]);
      }
    }
  }
  return headerList;
}

// CachePolicy.Headers can store header values as string or string-array (for
// duplicate headers). Convert it to "Record of strings", which is all we allow
// for HeadersInit in Fetcher. (Perhaps we should expand that definition in
// `@apollo/utils.fetcher` to allow HeadersInit to be `string[][]` too; then we
// could use the same function as cachePolicyHeadersToNodeFetchHeadersInit here
// which would let us more properly support duplicate headers in *requests* if
// using node-fetch.)
function cachePolicyHeadersToFetcherHeadersInit(
  headers: CachePolicy.Headers,
): Record<string, string> {
  const headerRecord = Object.create(null);
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      headerRecord[name] = value;
    } else if (value) {
      headerRecord[name] = value.join(', ');
    }
  }
  return headerRecord;
}
