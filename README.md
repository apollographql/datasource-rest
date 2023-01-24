# Apollo REST Data Source

This package exports a ([`RESTDataSource`](https://github.com/apollographql/datasource-rest#apollo-rest-data-source)) class which is used for fetching data from a REST API and exposing it via GraphQL within Apollo Server.

RESTDataSource wraps an implementation of the DOM-style Fetch API such as `node-fetch` and adds the following features:
- Two layers of caching:
  + An in-memory "request deduplication" feature which by default avoids sending the same GET (or HEAD) request multiple times in parallel.
  + An "HTTP cache" which provides browser-style caching in a (potentially shared) `KeyValueCache` which observes standard HTTP caching headers.
- Convenience features such as the ability to specify an un-serialized object as a JSON request body and an easy way to specify URL search parameters
- Error handling

## Documentation

View the [Apollo Server documentation for RESTDataSource](https://www.apollographql.com/docs/apollo-server/data/fetching-rest) for more high-level details and examples.

## Usage

To get started, install the `@apollo/datasource-rest` package:

```bash
npm install @apollo/datasource-rest
```

To define a data source, extend the [`RESTDataSource`](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) class and implement the data fetching methods that your resolvers require.  Data sources can then be provided via Apollo Server's `context` object during execution.

Your implementation of these methods can call convenience methods built into the [`RESTDataSource`](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) class to perform HTTP requests, while making it easy to build up query parameters, parse JSON results, and handle errors.

```javascript
const { RESTDataSource } = require('@apollo/datasource-rest');

class MoviesAPI extends RESTDataSource {
  override baseURL = 'https://movies-api.example.com/';

  async getMovie(id) {
    return this.get(`movies/${encodeURIComponent(id)}`);
  }

  async getMostViewedMovies(limit = 10) {
    const data = await this.get('movies', {
      params: {
        per_page: limit.toString(), // all params entries should be strings
        order_by: 'most_viewed',
      },
    });
    return data.results;
  }
}
```

### API Reference

`RESTDataSource` is designed to be subclassed in order to create an API for use by the rest of your server. Many of its methods are protected. These consist of HTTP fetching methods (`fetch`, `get`, `put`, `post`, `patch`, `delete`, and `head`) which your API can call, and other methods that can be overridden to customize behavior.

This README lists all the protected methods. In practice, if you're looking to customize behavior by overriding methods, reading the [source code](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) is the best option.

#### Properties

##### `baseURL`
Optional value to use for all the REST calls. If it is set in your class implementation, this base URL is used as the prefix for all calls. If it is not set, then the value passed to the REST call is exactly the value used. See also `resolveURL`.

```js title="baseURL.js"
class MoviesAPI extends RESTDataSource {
  override baseURL = 'https://movies-api.example.com/';

  // GET
  async getMovie(id) {
    return this.get(
      `movies/${encodeURIComponent(id)}` // path
    );
  }
}
```

`RESTDataSource` interprets the string passed to methods such as `this.get()` as an URL in exactly the same way that a browser interprets a link on a web page whose address is the same as `this.baseURL`. This may lead to slightly surprising behavior if `this.baseURL` has a non-empty path component:

- If the string passed to a method such as `this.get()` starts with a slash, then it is resolved relative to the *host* of the base URL, not to the full base URL. That is, if `this.baseURL` is `https://foo.com/a/b/c/`, then `this.get('d')` resolves to `https://foo.com/a/b/c/d`, but `this.get('/d')` resolves to `https://foo.com/d`.
- If the base URL has a path element and does not end in a slash, then the given path replaces the last element of the path. That is, if `baseURL` is `https://foo.com/a/b/c`, `this.get('d')` resolves to `https://foo.com/a/b/d`

In practice, this means that you should usually set `this.baseURL` to the common prefix of all URLs you want to access *including a trailing slash*, and you should pass paths *without a leading slash* to methods such as `this.get()`.

If a resource's path starts with something that looks like an URL because it contains a colon and you want it to be added on to the full base URL after its path (so you can't pass it as `this.get('/foo:bar')`), you can pass a path starting with `./`, like `this.get('./foo:bar')`.

##### `httpCache`

This is an internal object that adds HTTP-header-sensitive caching to HTTP fetching. Its exact API is internal to this package and may change between versions.


#### Overridable methods

##### `cacheKeyFor`
By default, `RESTDatasource` uses the `cacheKey` option from the request as the cache key, or the request method and full request URL otherwise when saving information about the request to the `KeyValueCache`. Override this method to remove query parameters or compute a custom cache key.

For example, you could use this to use header fields or the HTTP method as part of the cache key. Even though we do validate header fields and don't serve responses from cache when they don't match, new responses overwrite old ones with different header fields. (For the HTTP method, this might be a positive thing, as you may want a `POST /foo` request to stop a previously cached `GET /foo` from being returned.)

##### `requestDeduplicationPolicyFor`

By default, `RESTDataSource` de-duplicates all **concurrent** outgoing **`GET` (or `HEAD`) requests** in an in-memory cache, separate from the `KeyValueCache` used for the HTTP response cache. It makes the assumption that two `GET` (or two `HEAD`) requests to the same URL made in parallel can share the same response. When the request returns, its response is delivered to each caller that requested the same URL concurrently, and then it is removed from the cache.

If a request is made with the same cache key (method + URL by default) but with an HTTP method other than `GET` or `HEAD`, deduplication of the in-flight request is invalidated: the next parallel `GET` (or `HEAD`) request for the same URL will make a new request.

You can configure this behavior in several ways:
- You can change which requests are de-deduplicated and which are not.
- You can tell `RESTDataSource` to de-duplicate a request against new requests that start after it completes, not just overlapping requests. (This was the poorly-documented behavior of `RESTDataSource` prior to v5.0.0.)
- You can control the "deduplication key" independently from the `KeyValueCache` cache key.

You do this by overriding the `requestDeduplicationPolicyFor` method in your class. This method takes an URL and a request, and returns a policy object with one of three forms:

- `{policy: 'deduplicate-during-request-lifetime', deduplicationKey: string}`: This is the default behavior for `GET` requests. If a request with the same deduplication key is in progress, share its result. Otherwise, start a request, allow other requests to de-duplicate against it while it is running, and forget about it once the request returns successfully.
- `{policy: 'deduplicate-until-invalidated', deduplicationKey: string}`: This was the default behavior for `GET` requests in versions prior to v5. If a request with the same deduplication key is in progress, share its result. Otherwise, start a request and allow other requests to de-duplicate against it while it is running. All future requests with policy `deduplicate-during-request-lifetime` or `deduplicate-until-invalidated` with the same `deduplicationKey` will share the same result until a request is started with policy `do-not-deduplicate` and a matching entry in `invalidateDeduplicationKeys`.
- `{ policy: 'do-not-deduplicate'; invalidateDeduplicationKeys?: string[] }`: This is the default behavior for non-`GET` requests. Always run an actual HTTP request and don't allow other requests to de-duplicate against it. Additionally, invalidate any listed keys immediately: new requests with that `deduplicationKey` will not match any requests that currently exist in the request cache.

The default implementation of this method is:

```ts
protected requestDeduplicationPolicyFor(
  url: URL,
  request: RequestOptions,
): RequestDeduplicationPolicy {
  const method = request.method ?? 'GET';
  // Start with the cache key that is used for the shared header-sensitive
  // cache. Note that its default implementation does not include the HTTP
  // method, so if a subclass overrides this and allows non-GET/HEADs to be
  // de-duplicated it will be important for it to include (at least!) the
  // method in the deduplication key, so we're explicitly adding GET/HEAD here.
  const cacheKey = this.cacheKeyFor(url, request);
  if (['GET', 'HEAD'].includes(method)) {
    return {
      policy: 'deduplicate-during-request-lifetime',
      deduplicationKey: `${method} ${cacheKey}`,
    };
  } else {
    return {
      policy: 'do-not-deduplicate',
      // Always invalidate GETs and HEADs when a different method is seen on the same
      // cache key (ie, URL), as per standard HTTP semantics. (We don't have
      // to invalidate the key with this HTTP method because we never write
      // it.)
      invalidateDeduplicationKeys: [
        this.cacheKeyFor(url, { ...request, method: 'GET' }),
        this.cacheKeyFor(url, { ...request, method: 'HEAD' }),
      ],
    };
  }
```

To fully disable de-duplication, just always return `do-not-duplicate`. (This does not affect the HTTP header-sensitive cache.)

```ts
class MoviesAPI extends RESTDataSource {
  protected override requestDeduplicationPolicyFor() {
    return { policy: 'do-not-deduplicate' } as const;
  }
}
```

##### `willSendRequest`
This method is invoked at the beginning of processing each request. It's called with the `path` and `request` provided to `fetch`, with a guaranteed non-empty `headers` and `params` objects. If a `Promise` is returned from this method it will wait until the promise is completed to continue executing the request. See the [intercepting fetches](#intercepting-fetches) section for usage examples.

##### `resolveURL`

In some cases, you'll want to set the URL based on the environment or other contextual values rather than simply resolving against `this.baseURL`. To do this, you can override `resolveURL`:

```ts
import type { KeyValueCache } from '@apollo/utils.keyvaluecache';

class PersonalizationAPI extends RESTDataSource {
  override async resolveURL(path: string, _request: AugmentedRequest) {
    if (!this.baseURL) {
      const addresses = await resolveSrv(path.split("/")[1] + ".service.consul");
      this.baseURL = addresses[0];
    }
    return super.resolveURL(path);
  }
}
```

##### `cacheOptionsFor`
Allows setting the `CacheOptions` to be used for each request/response in the `HTTPCache`. This is separate from the request-only cache. You can use this to set the TTL to a value in seconds. If you return `{ttl: 0}`, the response will not be stored. If you return a positive number for `ttl` and the operation returns a 2xx status code, then the response *will* be cached, regardless of HTTP headers: make sure this is what you intended! (There is currently no way to say "only cache responses that should be cached according to HTTP headers, but change the TTL to something specific".) Note that if you do not specify `ttl` here, only `GET` requests are cached.

You can also specify `cacheOptions` as part of the "request" in any call to `get()`, `post()`, etc. Note that specifically `head()` calls are not cached at all, so this will have no effect for `HEAD` requests. This can either be an object such as `{ttl: 1}`, or a function returning that object. If `cacheOptions` is provided, `cacheOptionsFor` is not called (ie, `this.cacheOptionsFor` is effectively the default value of `cacheOptions`).

The `cacheOptions` function and `cacheOptionsFor` method may be async.

```javascript
override cacheOptionsFor() {
  return {
    ttl: 1
  }
}
```

##### `didEncounterError`

> Note: In previous versions of RESTDataSource (< v5), this hook was expected to throw the error it received (the default implementation did exactly that). This is no longer required; as mentioned below, the error will be thrown immediately after invoking `didEncounterError`.

You can implement this hook in order to inspect (or modify) errors that are thrown while fetching, parsing the body (`parseBody()`), or by the `throwIfResponseIsError()` hook. The error that this hook receives will be thrown immediately after this hook is invoked.

You can also throw a different error here altogether. Note that by default, errors are `GraphQLError`s (coming from `errorFromResponse`).

##### `parseBody`

This method is called with the HTTP response and should read the body and parse it into an appropriate format. By default, it checks to see if the `Content-Type` header starts with `application/json` or ends with `+json` (just looking at the header as a string without using a Content-Type parser) and returns `response.json()` if it does or `response.text()` if it does not. If you want to read the body in a different way, override this. This method should read the response fully; if it does not, it could cause a memory leak inside the HTTP cache. If you override this, you may want to override `cloneParsedBody` as well.

##### `cloneParsedBody`

This method is used to clone a body (for use by the request deduplication feature so that multiple callers get distinct return values that can be separately mutated). If your `parseBody` returns values other than basic JSON objects, you might want to override this method too. You can also change this method to return its argument without cloning if your code that uses this class is OK with the values returned from deduplicated requests sharing state.

##### `shouldJSONSerializeBody`

By default, this method returns `true` if the request body is:
- a plain object or an array
- an object with a `toJSON` method (which isn't a `Buffer` or an instance of a class named `FormData`)

You can override this method in order to serialize other objects such as custom classes as JSON.

##### `throwIfResponseIsError`

After the body is parsed, this method checks a condition (by default, if the HTTP status is 4xx or 5xx) and throws an error created with `errorFromResponse` if the condition is met.

##### `errorFromResponse`

Creates an error based on the response.

##### `catchCacheWritePromiseErrors`

This class writes to the shared HTTP-header-sensitive cache in the background (ie, the write is not awaited as part of the HTTP fetch). It passes the `Promise` associated with that cache write to this method. By default, this method adds a `catch` handler to the `Promise` which writes any errors to `console.error`. You could use this to do different error handling, or to do no error handling if you trust all callers to use the `fetch` method and await `httpCache.cacheWritePromise`.

##### `trace`

This method wraps the entire processing of a single request; if the `NODE_ENV` environment variable is equal to `development`, it logs the request method, URL, and duration. You can override this to provide observability in a different manner.


### HTTP Methods

The `get` method on the [`RESTDataSource`](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) makes an HTTP `GET` request and returns its parsed body. Similarly, there are methods built-in to allow for `POST`, `PUT`, `PATCH`, `DELETE`, and `HEAD` requests. (The `head` method returns the full `FetcherResponse` rather than the body because `HEAD` responses do not have bodies.)

```javascript
class MoviesAPI extends RESTDataSource {
  override baseURL = 'https://movies-api.example.com/';

  // an example making an HTTP POST request
  async postMovie(movie) {
    return this.post(
      `movies`, // path
      { body: movie }, // request body
    );
  }

  // an example making an HTTP PUT request
  async newMovie(movie) {
    return this.put(
      `movies`, // path
      { body: movie }, // request body
    );
  }

  // an example making an HTTP PATCH request
  async updateMovie(movie) {
    return this.patch(
      `movies`, // path
      { body: { id: movie.id, movie } }, // request body
    );
  }

  // an example making an HTTP DELETE request
  async deleteMovie(movie) {
    return this.delete(
      `movies/${encodeURIComponent(movie.id)}`, // path
    );
  }
}
```

All of the HTTP helper functions (`get`, `put`, `post`, `patch`, `delete`, and `head`) accept a second parameter for setting the `body`, `headers`, `params`, `cacheKey`, and `cacheOptions` (and other Fetch API options).

Alternatively, you can use the `fetch` method. The return value of this method is a `DataSourceFetchResult`, which contains `parsedBody`, `response`, and some other fields with metadata about how the operation interacted with the cache.

### Intercepting fetches

Data sources allow you to intercept fetches to set headers, query parameters, or make other changes to the outgoing request. This is most often used for authorization or other common concerns that apply to all requests. The `constructor` can be overridden to require additional contextual information when the class is instantiated like so:

```ts
class PersonalizationAPI extends RESTDataSource {
  private token: string;

  constructor(token: string) {
    super();
    this.token = token;
  }

  willSendRequest(path, request) {
    // set an authorization header
    request.headers['authorization'] = this.token;
    // or set a query parameter
    request.params.set('api_key', this.token);
  }
}
```

If you're using TypeScript, you can use the `AugmentedRequest` type to define the `willSendRequest` signature:
```ts
import { RESTDataSource, AugmentedRequest } from '@apollo/datasource-rest';

class PersonalizationAPI extends RESTDataSource {
  override baseURL = 'https://personalization-api.example.com/';

  private token: string;
  constructor(token: string) {
    super();
    this.token = token;
  }

  override willSendRequest(_path: string, request: AugmentedRequest) {
    request.headers['authorization'] = this.token;
  }
}
```

### Processing Responses

> Looking for `didReceiveResponse`? This section is probably interesting to you.

You might need to read or mutate the response before it's returned. For example, you might need to log a particular header for each request. To do this, you can override the public `fetch` method like so:

```ts
  class MyDataSource extends RESTDataSource {
    override async fetch<TResult>(
      path: string,
      incomingRequest: DataSourceRequest = {}
    ) {
      const result = await super.fetch(path, incomingRequest);
      const header = result.response.headers.get('my-custom-header');
      if (header) {
        console.log(`Found header: ${header}`);
      }
      return result;
    }
  }
```

This example leverages the default `fetch` implementation from the parent (`super`). We append our step to the promise chain, read the header, and return the original result that the `super.fetch` promise resolved to (`{ parsedBody, response }`).

### Integration with Apollo Server

To give resolvers access to data sources, you create and return them from your `context` function. (The following example uses the Apollo Server 4 API.)

```ts
interface MyContext {
  movies: MoviesAPI;
  personalization: PersonalizationAPI;
}

const server = new ApolloServer<MyContext>({
  typeDefs,
  resolvers,
});

// The context function you provide to your integration should handle constructing your data sources on every request.
const url = await startStandaloneServer(server, {
  async context({ req }) { 
    return {
      moviesAPI: new MoviesAPI(),
      personalizationAPI: new PersonalizationAPI(req.headers['authorization']),
    };
  },
});
```

From our resolvers, we can access the data source from context and return the result:

```javascript
const resolvers = {
  Query: {
    movie: async (_source, { id }, { moviesAPI }) => {
      return moviesAPI.getMovie(id);
    },
    mostViewedMovies: async (_source, _args, { moviesAPI }) => {
      return moviesAPI.getMostViewedMovies();
    },
    favorites: async (_source, _args, { personalizationAPI }) => {
      return personalizationAPI.getFavorites();
    },
  },
};
```
