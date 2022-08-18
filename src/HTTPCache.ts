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
      const response = await this.httpFetch(urlString, requestOpts);

      const policy = new CachePolicy(
        policyRequestFrom(urlString, requestOpts),
        policyResponseFrom(response),
      );

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

    const policy = CachePolicy.fromObject(policyRaw);
    // Remove url from the policy, because otherwise it would never match a request with a custom cache key
    policy._url = undefined;

    if (
      (ttlOverride && policy.age() < ttlOverride) ||
      (!ttlOverride &&
        policy.satisfiesWithoutRevalidation(
          policyRequestFrom(urlString, requestOpts),
        ))
    ) {
      const headers = policy.responseHeaders();
      return new Response(body, {
        url: policy._url,
        status: policy._status,
        headers,
      });
    } else {
      const revalidationHeaders = policy.revalidationHeaders(
        policyRequestFrom(urlString, requestOpts),
      );
      const revalidationRequest: RequestOptions = {
        ...requestOpts,
        headers: revalidationHeaders,
      };
      const revalidationResponse = await this.httpFetch(
        urlString,
        revalidationRequest,
      );

      const { policy: revalidatedPolicy, modified } = policy.revalidatedPolicy(
        policyRequestFrom(urlString, revalidationRequest),
        policyResponseFrom(revalidationResponse),
      );

      return this.storeResponseAndReturnClone(
        urlString,
        new Response(modified ? await revalidationResponse.text() : body, {
          url: revalidatedPolicy._url,
          status: revalidatedPolicy._status,
          headers: revalidatedPolicy.responseHeaders(),
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
    policy: CachePolicy,
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

    // If a response can be revalidated, we don't want to remove it from the cache right after it expires.
    // We may be able to use better heuristics here, but for now we'll take the max-age times 2.
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
  return response.headers.has('ETag');
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
