import fetch, { Response } from 'node-fetch';
import CachePolicy from 'http-cache-semantics';
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
import type { CacheOptions, RequestOptions } from './RESTDataSource';

// We want to use a couple internal properties of CachePolicy. (We could get
// `_url` and `_status` off of the serialized CachePolicyObject, but `age()` is
// just missing from `@types/http-cache-semantics` for now.) So we just cast to
// this interface for now.
interface SneakyCachePolicy extends CachePolicy {
  _url: string | undefined;
  _status: number;
  age(): number;
}

export class HTTPCache {
  private keyValueCache: KeyValueCache;
  private httpFetch: Fetcher;

  constructor(
    keyValueCache: KeyValueCache = new InMemoryLRUCache(),
    httpFetch: Fetcher = fetch,
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
          ) => CacheOptions | undefined);
    },
  ): Promise<FetcherResponse> {
    const urlString = url.toString();
    requestOpts.method = requestOpts.method ?? 'GET';
    const cacheKey = cache?.cacheKey ?? urlString;

    const entry = await this.keyValueCache.get(cacheKey);
    if (!entry) {
      // There's nothing in our cache. Fetch the URL and save it to the cache if
      // we're allowed.
      const response = await this.httpFetch(urlString, requestOpts);

      const policy = new CachePolicy(
        policyRequestFrom(urlString, requestOpts),
        policyResponseFrom(response),
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
      return new Response(body, {
        url: urlFromPolicy,
        status: policy._status,
        headers: normalizeHeaders(headers),
      });
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
        headers: normalizeHeaders(revalidationHeaders),
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
        new Response(modified ? await revalidationResponse.text() : body, {
          url: revalidatedPolicy._url,
          status: revalidatedPolicy._status,
          headers: normalizeHeaders(revalidatedPolicy.responseHeaders()),
        }),
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
        ) => CacheOptions | undefined),
  ): Promise<FetcherResponse> {
    if (typeof cacheOptions === 'function') {
      cacheOptions = cacheOptions(url, response, request);
    }

    let ttlOverride = cacheOptions?.ttl;

    if (
      // With a TTL override, only cache successful responses but otherwise ignore method and response headers
      !(ttlOverride && policy._status >= 200 && policy._status <= 299) &&
      // Without an override, we only cache GET requests and respect standard HTTP cache semantics
      !(request.method === 'GET' && policy.storable())
    ) {
      return response;
    }

    let ttl =
      ttlOverride === undefined
        ? Math.round(policy.timeToLive() / 1000)
        : ttlOverride;
    if (ttl <= 0) return response;

    // If a response can be revalidated, we don't want to remove it from the
    // cache right after it expires. (See the comment above the call to
    // `revalidationHeaders` for details.) We may be able to use better
    // heuristics here, but for now we'll take the max-age times 2.
    if (canBeRevalidated(response)) {
      ttl *= 2;
    }

    const body = await response.text();
    const entry = JSON.stringify({
      policy: policy.toObject(),
      ttlOverride,
      body,
    });

    await this.keyValueCache.set(cacheKey, entry, {
      ttl,
    });

    // We have to clone the response before returning it because the
    // body can only be used once.
    // To avoid https://github.com/bitinn/node-fetch/issues/151, we don't use
    // response.clone() but create a new response from the consumed body
    return new Response(body, {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
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
    headers: Object.fromEntries(response.headers),
  };
}

// When CachePolicy gives us headers back, it is declared to have the same
// structure as Node's built in res.headers, where values might be arrays.
// However, we use fetch to do the actual HTTP calls, and fetch's response
// headers always map string to string: ie, the input to CachePolicy always
// comes from `policyResponseFrom` above`. So we can be pretty confident that
// the values in this map are strings (not arrays or numbers), as long as
// CachePolicy itself doesn't add arrays or numbers (and it doesn't appear to
// now). So we just do a cast (after double-checking that we didn't miss
// something).
function normalizeHeaders(
  headers: CachePolicy.Headers,
): Record<string, string> {
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      throw new Error(`Surprising type ${typeof value} for header ${name}`);
    }
  }
  return headers as Record<string, string>;
}
