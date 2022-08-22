import { HTTPCache } from './HTTPCache';
import { GraphQLError } from 'graphql';
import type { KeyValueCache } from '@apollo/utils.keyvaluecache';
import type {
  Fetcher,
  FetcherRequestInit,
  FetcherResponse,
} from '@apollo/utils.fetcher';
import type { WithRequired } from '@apollo/utils.withrequired';

type ValueOrPromise<T> = T | Promise<T>;

// URLSearchParams is globally available in Node / coming from @types/node
type URLSearchParamsInit = ConstructorParameters<typeof URLSearchParams>[0];

export type RequestOptions = FetcherRequestInit & {
  params?: URLSearchParamsInit;
  cacheOptions?:
    | CacheOptions
    | ((
        url: string,
        response: FetcherResponse,
        request: RequestOptions,
      ) => CacheOptions | undefined);
};

export type WillSendRequestOptions = Omit<
  WithRequired<RequestOptions, 'headers'>,
  'params'
> & {
  params: URLSearchParams;
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

export interface CacheOptions {
  ttl?: number;
}

const NODE_ENV = process.env.NODE_ENV;

export interface DataSourceConfig {
  cache?: KeyValueCache;
  fetch?: Fetcher;
}

export abstract class RESTDataSource {
  httpCache: HTTPCache;
  memoizedResults = new Map<string, Promise<any>>();
  baseURL?: string;
  memoizeGetRequests: boolean = true;

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

  protected willSendRequest?(
    requestOpts: WillSendRequestOptions,
  ): ValueOrPromise<void>;

  protected resolveURL(
    path: string,
    _request: RequestOptions,
  ): ValueOrPromise<URL> {
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

  protected cacheOptionsFor?(
    url: string,
    response: FetcherResponse,
    request: FetcherRequestInit,
  ): CacheOptions | undefined;

  protected async didReceiveResponse<TResult = any>(
    response: FetcherResponse,
    _request: RequestOptions,
  ): Promise<TResult> {
    if (response.ok) {
      return this.parseBody(response) as any as Promise<TResult>;
    } else {
      throw await this.errorFromResponse(response);
    }
  }

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

  private async fetch<TResult>(
    path: string,
    request: DataSourceRequest,
  ): Promise<TResult> {
    const modifiedRequest: WillSendRequestOptions = {
      ...request,
      // guarantee params and headers objects before calling `willSendRequest` for convenience
      params:
        request.params instanceof URLSearchParams
          ? request.params
          : new URLSearchParams(request.params),
      headers: request.headers ?? Object.create(null),
      body: undefined,
    };

    if (this.willSendRequest) {
      await this.willSendRequest(modifiedRequest);
    }

    const url = await this.resolveURL(path, modifiedRequest);

    // Append params to existing params in the path
    for (const [name, value] of modifiedRequest.params as URLSearchParams) {
      url.searchParams.append(name, value);
    }

    // We accept arbitrary objects and arrays as body and serialize them as JSON
    if (
      request.body !== undefined &&
      request.body !== null &&
      (request.body.constructor === Object ||
        Array.isArray(request.body) ||
        ((request.body as any).toJSON &&
          typeof (request.body as any).toJSON === 'function'))
    ) {
      modifiedRequest.body = JSON.stringify(request.body);
      // If Content-Type header has not been previously set, set to application/json
      if (!modifiedRequest.headers) {
        modifiedRequest.headers = { 'content-type': 'application/json' };
      } else if (!modifiedRequest.headers['content-type']) {
        modifiedRequest.headers['content-type'] = 'application/json';
      }
    }

    const cacheKey = this.cacheKeyFor(url, modifiedRequest);

    const performRequest = async () => {
      return this.trace(url, modifiedRequest, async () => {
        const cacheOptions = modifiedRequest.cacheOptions
          ? modifiedRequest.cacheOptions
          : this.cacheOptionsFor?.bind(this);
        try {
          const response = await this.httpCache.fetch(url, modifiedRequest, {
            cacheKey,
            cacheOptions,
          });
          return await this.didReceiveResponse(response, modifiedRequest);
        } catch (error) {
          this.didEncounterError(error as Error, modifiedRequest);
        }
      });
    };

    // Cache GET requests based on the calculated cache key
    // Disabling the request cache does not disable the response cache
    if (this.memoizeGetRequests) {
      if (request.method === 'GET') {
        let promise = this.memoizedResults.get(cacheKey);
        if (promise) return promise;

        promise = performRequest();
        this.memoizedResults.set(cacheKey, promise);
        return promise;
      } else {
        this.memoizedResults.delete(cacheKey);
        return performRequest();
      }
    } else {
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
