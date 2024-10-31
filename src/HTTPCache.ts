import nodeFetch, {
  Response as NodeFetchResponse,
  Headers as NodeFetchHeaders,
  type HeadersInit as NodeFetchHeadersInit,
} from 'node-fetch';
import CachePolicy from 'http-cache-semantics';
import type { Options as HttpCacheSemanticsOptions } from 'http-cache-semantics';
import type { Fetcher, FetcherResponse } from '@apollo/utils.fetcher';
import {
  type KeyValueCache,
  InMemoryLRUCache,
  PrefixingKeyValueCache,
} from '@apollo/utils.keyvaluecache';
import type {
  CacheOptions,
  RequestOptions,
  ValueOrPromise,
} from './RESTDataSource';

interface PolicyCacheEntry {
  policy: any;
  ttlOverride?: number;
  body: string;
}

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
  parsedBody?: any;
}

export class HTTPCache<CO extends CacheOptions = CacheOptions> {
  private keyValueCache: KeyValueCache<string, CO>;
  private httpFetch: Fetcher;

  constructor(
    keyValueCache: KeyValueCache = new InMemoryLRUCache<string, CO>(),
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
    requestOpts: RequestOptions<CO> = {},
    cache?: {
      cacheKey?: string;
      cacheOptions?:
        | CO
        | ((
            url: string,
            response: FetcherResponse,
            request: RequestOptions<CO>,
          ) => ValueOrPromise<CO | undefined>);
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

    let cacheOptions = cache?.cacheOptions;
    if (typeof cacheOptions === 'function') {
      const response = await this.httpFetch(urlString, requestOpts);
      cacheOptions = await cacheOptions(urlString, response, requestOpts);
      if (cacheOptions?.cacheStrategy === 'object') {
        const parsedBody = await response.json();
        // Store in cache if ttl is provided
        if (cacheOptions?.ttl) {
          const cacheWritePromise = this.keyValueCache.set(
            cacheKey,
            parsedBody,
            cacheOptions as CO
          ).catch(error => {
            console.error('Error writing to cache:', error);
          });
          return { response, parsedBody, cacheWritePromise };
        }
        return { response, parsedBody };
      }
      // Handle policy-based caching
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
        cacheOptions,
      );
    }

    // Determine caching strategy
    const cacheStrategy = cacheOptions?.cacheStrategy ?? 'default';

    if (cacheStrategy === 'object') {
      return this.handleDirectCache(urlString, requestOpts, cacheKey, cacheOptions);
    }

    return this.handlePolicyCache(
      urlString,
      requestOpts,
      cacheKey,
      cacheOptions,
      cache?.httpCacheSemanticsCachePolicyOptions
    );
  }

  private async handleDirectCache(
    urlString: string,
    requestOpts: RequestOptions<CO>,
    cacheKey: string,
    cacheOptions?: CacheOptions,
  ): Promise<ResponseWithCacheWritePromise> {
    if (requestOpts.skipCache) {
      const response = await this.httpFetch(urlString, requestOpts);
      const parsedBody = await response.json();
      return { response, parsedBody };
    }

    const cachedValue = await this.keyValueCache.get(cacheKey);
    if (cachedValue !== undefined) {
      return {
        response: new NodeFetchResponse(undefined, { status: 200 }),
        parsedBody: cachedValue,
      };
    }

    const response = await this.httpFetch(urlString, requestOpts);
    const parsedBody = await response.json();

    if (cacheOptions?.ttl) {
      const cacheWritePromise = this.keyValueCache.set(
        cacheKey,
        parsedBody,
        cacheOptions as CO
      ).catch(error => {
        console.error('Error writing to cache:', error);
      });
      return { response, parsedBody, cacheWritePromise };
    }

    return { response, parsedBody };
  }

  private async handlePolicyCache(
    urlString: string,
    requestOpts: RequestOptions<CO>,
    cacheKey: string,
    cacheOptions?: CO,
    httpCacheSemanticsCachePolicyOptions?: HttpCacheSemanticsOptions,
  ): Promise<ResponseWithCacheWritePromise> {
    const entry = requestOpts.skipCache !== true
      ? await this.keyValueCache.get(cacheKey)
      : undefined;

    if (!entry) {
      const response = await this.httpFetch(urlString, requestOpts);
      const policy = new CachePolicy(
        policyRequestFrom(urlString, requestOpts),
        policyResponseFrom(response),
        httpCacheSemanticsCachePolicyOptions,
      ) as SneakyCachePolicy;

      return this.storeResponseAndReturnClone(
        urlString,
        response,
        requestOpts,
        policy,
        cacheKey,
        cacheOptions,
      );
    }

    const { policy: policyRaw, ttlOverride, body } = JSON.parse(entry) as PolicyCacheEntry;
    const policy = CachePolicy.fromObject(policyRaw) as SneakyCachePolicy;
    const urlFromPolicy = policy._url;
    policy._url = undefined;

    if (
      (ttlOverride && policy.age() < ttlOverride) ||
      (!ttlOverride &&
        policy.satisfiesWithoutRevalidation(
          policyRequestFrom(urlString, requestOpts),
        ))
    ) {
      const headers = policy.responseHeaders();
      return {
        response: new NodeFetchResponse(body, {
          url: urlFromPolicy,
          status: policy._status,
          headers: cachePolicyHeadersToNodeFetchHeadersInit(headers),
        }),
      };
    }

    const revalidationHeaders = policy.revalidationHeaders(
      policyRequestFrom(urlString, requestOpts),
    );
    const revalidationRequest = {
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
      cacheOptions,
    );
  }

  private async storeResponseAndReturnClone(
    url: string,
    response: FetcherResponse,
    request: RequestOptions<CO>,
    policy: SneakyCachePolicy,
    cacheKey: string,
    cacheOptions?: CO,
  ): Promise<ResponseWithCacheWritePromise> {
    if (typeof cacheOptions === 'function') {
      // @ts-ignore
      cacheOptions = await cacheOptions(url, response, request);
    }

    const ttlOverride = cacheOptions?.ttl;

    if (
      !(ttlOverride && policy._status >= 200 && policy._status <= 299) &&
      !(request.method === 'GET' && policy.storable())
    ) {
      return { response };
    }

    const ttl = ttlOverride ?? Math.round(policy.timeToLive() / 1000);
    if (ttl <= 0) return { response };

    const returnedResponse = response.clone();
    const body = await response.text();

    const entry: PolicyCacheEntry = {
      policy: policy.toObject(),
      ttlOverride,
      body,
    };

    const cacheWritePromise = this.keyValueCache
      .set(cacheKey, JSON.stringify(entry), {
        ...cacheOptions,
        ttl: canBeRevalidated(response) ? ttl * 2 : ttl,
      } as CO)
      .catch(error => {
        console.error('Error writing to cache:', error);
      });

    return { response: returnedResponse, cacheWritePromise };
  }
}

function canBeRevalidated(response: FetcherResponse): boolean {
  return response.headers.has('ETag') || response.headers.has('Last-Modified');
}

function policyRequestFrom<CO extends CacheOptions = CacheOptions>(
  url: string,
  request: RequestOptions<CO>,
) {
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
      response.headers instanceof NodeFetchHeaders &&
      // https://github.com/apollo-server-integrations/apollo-server-integration-cloudflare-workers/issues/37
      // For some reason, Cloudflare Workers' `response.headers` is passing
      // the instanceof check here but doesn't have the `raw()` method that
      // node-fetch's headers have.
      'raw' in response.headers
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
    if (Array.isArray(value)) {
      for (const subValue of value) {
        headerList.push([name, subValue]);
      }
    } else if (value) {
      headerList.push([name, value]);
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
    if (Array.isArray(value)) {
      headerRecord[name] = value.join(', ');
    } else if (value) {
      headerRecord[name] = value;
    }
  }
  return headerRecord;
}
