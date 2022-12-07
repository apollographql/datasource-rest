import type {
  Fetcher,
  FetcherRequestInit,
  FetcherResponse,
} from '@apollo/utils.fetcher';
import type { KeyValueCache } from '@apollo/utils.keyvaluecache';
import type { WithRequired } from '@apollo/utils.withrequired';
import { GraphQLError } from 'graphql';
import isPlainObject from 'lodash.isplainobject';
import { HTTPCache } from './HTTPCache';
import type { Options as HttpCacheSemanticsOptions } from 'http-cache-semantics';

type ValueOrPromise<T> = T | Promise<T>;

export type RequestOptions = FetcherRequestInit & {
  /**
   * URL search parameters can be provided either as a record object (in which
   * case keys with `undefined` values are ignored) or as an URLSearchParams
   * object. If you want to specify a parameter multiple times, use
   * URLSearchParams with its "array of two-element arrays" constructor form.
   * (The URLSearchParams object is globally available in Node, and provided to
   * TypeScript by @types/node.)
   */
  params?: Record<string, string | undefined> | URLSearchParams;
  /**
   * This can be a `CacheOptions` object or a function returning such an object.
   * The details of what its fields mean are documented under `CacheOptions`.
   * The function is called after a real HTTP request is made (and is not called
   * if a response from the cache can be returned). If this is provided, the
   * `cacheOptionsFor` hook is not called.
   */
  cacheOptions?:
    | CacheOptions
    | ((
        url: string,
        response: FetcherResponse,
        request: RequestOptions,
      ) => CacheOptions | undefined);
  /**
   * If provided, this is passed through as the third argument to `new
   * CachePolicy()` from the `http-cache-semantics` npm package as part of the
   * HTTP header-sensitive cache.
   */
  httpCacheSemanticsCachePolicyOptions?: HttpCacheSemanticsOptions;
};

export interface GetRequest extends RequestOptions {
  method?: 'GET';
  body?: never;
}

export interface RequestWithBody extends Omit<RequestOptions, 'body'> {
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: FetcherRequestInit['body'] | object;
}

type DataSourceRequest = GetRequest | RequestWithBody;

// While tempting, this union can't be reduced / factored out to just
// Omit<WithRequired<GetRequest | RequestWithBody, 'headers'>, 'params'> & { params: URLSearchParams }
// TS loses its ability to discriminate against the method (and its consequential `body` type)
/**
 * This type is for convenience w.r.t. the `willSendRequest` and `resolveURL`
 * hooks to ensure that headers and params are always present, even if they're
 * empty.
 */
export type AugmentedRequest = (
  | Omit<WithRequired<GetRequest, 'headers'>, 'params'>
  | Omit<WithRequired<RequestWithBody, 'headers'>, 'params'>
) & {
  params: URLSearchParams;
};

export interface CacheOptions {
  /**
   * This sets the TTL used in the shared cache to a value in seconds. If this
   * is 0, the response will not be stored. If this is a positive number  and
   * the operation returns a 2xx status code, then the response *will* be
   * cached, regardless of HTTP headers or method: make sure this is what you
   * intended! (There is currently no way to say "only cache responses that
   * should be cached according to HTTP headers, but change the TTL to something
   * specific".) Note that if this is not provided, only `GET` requests are
   * cached.
   */
  ttl?: number;
}

const NODE_ENV = process.env.NODE_ENV;

export interface DataSourceConfig {
  cache?: KeyValueCache;
  fetch?: Fetcher;
}

// RESTDataSource has two layers of caching. The first layer is purely in-memory
// within a single RESTDataSource object and is called "request deduplication".
// It is primarily designed so that multiple identical GET requests started
// concurrently can share one real HTTP GET; it does not observe HTTP response
// headers. (The second layer uses a potentially shared KeyValueCache for
// storage and does observe HTTP response headers.) To configure request
// deduplication, override requestDeduplicationPolicyFor.
export type RequestDeduplicationPolicy =
  // If a request with the same deduplication key is in progress, share its
  // result. Otherwise, start a request, allow other requests to de-duplicate
  // against it while it is running, and forget about it once the request returns
  // successfully.
  | { policy: 'deduplicate-during-request-lifetime'; deduplicationKey: string }
  // If a request with the same deduplication key is in progress, share its
  // result. Otherwise, start a request and allow other requests to de-duplicate
  // against it while it is running. All future requests with policy
  // `deduplicate-during-request-lifetime` or `deduplicate-until-invalidated`
  // with the same `deduplicationKey` will share the same result until a request
  // is started with policy `do-not-deduplicate` and a matching entry in
  // `invalidateDeduplicationKeys`.
  | { policy: 'deduplicate-until-invalidated'; deduplicationKey: string }
  // Always run an actual HTTP request and don't allow other requests to
  // de-duplicate against it. Additionally, invalidate any listed keys
  // immediately: new requests with that deduplicationKey will not match any
  // requests that current exist. (The invalidation feature is used so that
  // doing (say) `DELETE /path` invalidates any result for `GET /path` within
  // the deduplication store.)
  | { policy: 'do-not-deduplicate'; invalidateDeduplicationKeys?: string[] };

export abstract class RESTDataSource {
  httpCache: HTTPCache;
  protected deduplicationPromises = new Map<string, Promise<any>>();
  baseURL?: string;

  constructor(config?: DataSourceConfig) {
    this.httpCache = new HTTPCache(config?.cache, config?.fetch);
  }

  // By default, we use the full request URL as the cache key.
  // You can override this to remove query parameters or compute a cache key in any way that makes sense.
  // For example, you could use this to take Vary header fields into account.
  // Although we do validate header fields and don't serve responses from cache when they don't match,
  // new responses overwrite old ones with different vary header fields.
  protected cacheKeyFor(url: URL, _request: RequestOptions): string {
    return url.toString();
  }

  /**
   * Calculates the deduplication policy for the request.
   *
   * By default, GET requests have the policy
   * `deduplicate-during-request-lifetime` with deduplication key `GET
   * ${cacheKey}`, and all other requests have the policy `do-not-deduplicate`
   * and invalidate `GET ${cacheKey}`, where `cacheKey` is the value returned by
   * `cacheKeyFor` (and is the same cache key used in the HTTP-header-sensitive
   * shared cache).
   *
   * Note that the default cache key only contains the URL (not the method,
   * headers, body, etc), so if you send multiple GET requests that differ only
   * in headers (etc), or if you change your policy to allow non-GET requests to
   * be deduplicated, you may want to put more information into the cache key or
   * be careful to keep the HTTP method in the deduplication key.
   */
  protected requestDeduplicationPolicyFor(
    url: URL,
    request: RequestOptions,
  ): RequestDeduplicationPolicy {
    // Start with the cache key that is used for the shared header-sensitive
    // cache. Note that its default implementation does not include the HTTP
    // method, so if a subclass overrides this and allows non-GETs to be
    // de-duplicated it will be important for it to include (at least!) the
    // method in the deduplication key, so we're explicitly adding GET here.
    const cacheKey = this.cacheKeyFor(url, request);
    if (request.method === 'GET') {
      return {
        policy: 'deduplicate-during-request-lifetime',
        deduplicationKey: `${request.method} ${cacheKey}`,
      };
    } else {
      return {
        policy: 'do-not-deduplicate',
        // Always invalidate GETs when a different method is seen on the same
        // cache key (ie, URL), as per standard HTTP semantics. (We don't have
        // to invalidate the key with this HTTP method because we never write
        // it.)
        invalidateDeduplicationKeys: [`GET ${cacheKey}`],
      };
    }
  }

  protected willSendRequest?(
    path: string,
    requestOpts: AugmentedRequest,
  ): ValueOrPromise<void>;

  protected resolveURL(
    path: string,
    _request: AugmentedRequest,
  ): ValueOrPromise<URL> {
    return new URL(path, this.baseURL);
  }

  protected cacheOptionsFor?(
    url: string,
    response: FetcherResponse,
    request: FetcherRequestInit,
  ): CacheOptions | undefined;

  protected didEncounterError(error: Error, _request: RequestOptions) {
    throw error;
  }

  protected parseBody(response: FetcherResponse): Promise<object | string> {
    const contentType = response.headers.get('Content-Type');
    const contentLength = response.headers.get('Content-Length');
    if (
      // As one might expect, a "204 No Content" is empty! This means there
      // isn't enough to `JSON.parse`, and trying will result in an error.
      response.status !== 204 &&
      contentLength !== '0' &&
      contentType &&
      (contentType.startsWith('application/json') ||
        contentType.endsWith('+json'))
    ) {
      return response.json();
    } else {
      return response.text();
    }
  }

  protected shouldJSONSerializeBody(body: RequestWithBody['body']): boolean {
    return !!(
      // We accept arbitrary objects and arrays as body and serialize them as JSON.
      (
        Array.isArray(body) ||
        isPlainObject(body) ||
        // We serialize any objects that have a toJSON method (except Buffers or things that look like FormData)
        (body &&
          typeof body === 'object' &&
          'toJSON' in body &&
          typeof (body as any).toJSON === 'function' &&
          !(body instanceof Buffer) &&
          // XXX this is a bit of a hacky check for FormData-like objects (in
          // case a FormData implementation has a toJSON method on it)
          (body as any).constructor?.name !== 'FormData')
      )
    );
  }

  protected async errorFromResponse(response: FetcherResponse) {
    const message = `${response.status}: ${response.statusText}`;

    let error: GraphQLError;
    if (response.status === 401) {
      error = new AuthenticationError(message);
    } else if (response.status === 403) {
      error = new ForbiddenError(message);
    } else {
      error = new GraphQLError(message);
    }

    const body = await this.parseBody(response);

    Object.assign(error.extensions, {
      response: {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        body,
      },
    });

    return error;
  }

  protected async get<TResult = any>(
    path: string,
    request?: GetRequest,
  ): Promise<TResult> {
    return this.fetch<TResult>(path, { method: 'GET', ...request });
  }

  protected async post<TResult = any>(
    path: string,
    request?: RequestWithBody,
  ): Promise<TResult> {
    return this.fetch<TResult>(path, { method: 'POST', ...request });
  }

  protected async patch<TResult = any>(
    path: string,
    request?: RequestWithBody,
  ): Promise<TResult> {
    return this.fetch<TResult>(path, { method: 'PATCH', ...request });
  }

  protected async put<TResult = any>(
    path: string,
    request?: RequestWithBody,
  ): Promise<TResult> {
    return this.fetch<TResult>(path, { method: 'PUT', ...request });
  }

  protected async delete<TResult = any>(
    path: string,
    request?: RequestWithBody,
  ): Promise<TResult> {
    return this.fetch<TResult>(path, { method: 'DELETE', ...request });
  }

  private urlSearchParamsFromRecord(
    params: Record<string, string | undefined> | undefined,
  ): URLSearchParams {
    const usp = new URLSearchParams();
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          usp.set(name, value);
        }
      }
    }
    return usp;
  }

  private async fetch<TResult>(
    path: string,
    incomingRequest: DataSourceRequest,
  ): Promise<TResult> {
    const augmentedRequest: AugmentedRequest = {
      ...incomingRequest,
      // guarantee params and headers objects before calling `willSendRequest` for convenience
      params:
        incomingRequest.params instanceof URLSearchParams
          ? incomingRequest.params
          : this.urlSearchParamsFromRecord(incomingRequest.params),
      headers: incomingRequest.headers ?? Object.create(null),
    };

    if (this.willSendRequest) {
      await this.willSendRequest(path, augmentedRequest);
    }

    const url = await this.resolveURL(path, augmentedRequest);

    // Append params to existing params in the path
    for (const [name, value] of augmentedRequest.params as URLSearchParams) {
      url.searchParams.append(name, value);
    }

    if (this.shouldJSONSerializeBody(augmentedRequest.body)) {
      augmentedRequest.body = JSON.stringify(augmentedRequest.body);
      // If Content-Type header has not been previously set, set to application/json
      if (!augmentedRequest.headers) {
        augmentedRequest.headers = { 'content-type': 'application/json' };
      } else if (!augmentedRequest.headers['content-type']) {
        augmentedRequest.headers['content-type'] = 'application/json';
      }
    }

    // At this point we know the `body` is a `string`, `Buffer`, or `undefined`
    // (not possibly an `object`).
    const outgoingRequest = augmentedRequest as RequestOptions;

    const performRequest = async () => {
      return this.trace(url, outgoingRequest, async () => {
        const cacheKey = this.cacheKeyFor(url, outgoingRequest);
        const cacheOptions = outgoingRequest.cacheOptions
          ? outgoingRequest.cacheOptions
          : this.cacheOptionsFor?.bind(this);
        try {
          const response = await this.httpCache.fetch(url, outgoingRequest, {
            cacheKey,
            cacheOptions,
            httpCacheSemanticsCachePolicyOptions:
              outgoingRequest.httpCacheSemanticsCachePolicyOptions,
          });

          if (response.ok) {
            return (await this.parseBody(response)) as TResult;
          } else {
            throw await this.errorFromResponse(response);
          }
        } catch (error) {
          this.didEncounterError(error as Error, outgoingRequest);
          throw error;
        }
      });
    };

    // Cache GET requests based on the calculated cache key
    // Disabling the request cache does not disable the response cache
    const policy = this.requestDeduplicationPolicyFor(url, outgoingRequest);
    if (
      policy.policy === 'deduplicate-during-request-lifetime' ||
      policy.policy === 'deduplicate-until-invalidated'
    ) {
      const previousRequestPromise = this.deduplicationPromises.get(
        policy.deduplicationKey,
      );
      if (previousRequestPromise) return previousRequestPromise;

      const thisRequestPromise = performRequest();
      this.deduplicationPromises.set(
        policy.deduplicationKey,
        thisRequestPromise,
      );
      try {
        // The request promise needs to be awaited here rather than just
        // returned. This ensures that the request completes before it's removed
        // from the cache. Additionally, the use of finally here guarantees the
        // deduplication cache is cleared in the event of an error during the
        // request.
        return await thisRequestPromise;
      } finally {
        if (policy.policy === 'deduplicate-during-request-lifetime') {
          this.deduplicationPromises.delete(policy.deduplicationKey);
        }
      }
    } else {
      for (const key of policy.invalidateDeduplicationKeys ?? []) {
        this.deduplicationPromises.delete(key);
      }
      return performRequest();
    }
  }

  protected async trace<TResult>(
    url: URL,
    request: RequestOptions,
    fn: () => Promise<TResult>,
  ): Promise<TResult> {
    if (NODE_ENV === 'development') {
      // We're not using console.time because that isn't supported on Cloudflare
      const startTime = Date.now();
      try {
        return await fn();
      } finally {
        const duration = Date.now() - startTime;
        const label = `${request.method || 'GET'} ${url}`;
        console.log(`${label} (${duration}ms)`);
      }
    } else {
      return fn();
    }
  }
}

export class AuthenticationError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: 'UNAUTHENTICATED' } });
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: 'FORBIDDEN' } });
    this.name = 'ForbiddenError';
  }
}
