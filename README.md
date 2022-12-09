# Apollo REST Data Source

This package exports a ([`RESTDataSource`](https://github.com/apollographql/datasource-rest#apollo-rest-data-source)) class which is used for fetching data from a REST API and exposing it via GraphQL within Apollo Server.

RESTDataSource provides two levels of caching: an in-memory "request deduplication" feature primarily used to avoid sending the same GET request multiple times in parallel, and an "HTTP cache" which provides browser-style caching in a (potentially shared) `KeyValueCache` which observes standard HTTP caching headers.

## Documentation

View the [Apollo Server documentation for data sources](https://www.apollographql.com/docs/apollo-server/features/data-sources/) for more details.

## Usage

To get started, install the `@apollo/datasource-rest` package:

```bash
npm install @apollo/datasource-rest
```

To define a data source, extend the [`RESTDataSource`](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) class and implement the data fetching methods that your resolvers require.  Data sources can then be provided via Apollo Server's `context` object during execution.

Your implementation of these methods can call on convenience methods built into the [`RESTDataSource`](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) class to perform HTTP requests, while making it easy to build up query parameters, parse JSON results, and handle errors.

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
        per_page: limit,
        order_by: 'most_viewed',
      },
    });
    return data.results;
  }
}
```

### API Reference
To see the all the properties and functions that can be overridden, the [source code](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) is always the best option.

#### Properties
##### `baseURL`
Optional value to use for all the REST calls. If it is set in your class implementation, this base URL is used as the prefix for all calls. If it is not set, then the value passed to the REST call is exactly the value used.

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


#### Methods

##### `cacheKeyFor`
By default, `RESTDatasource` uses the `cacheKey` option from the request as the cache key, or the request method and full request URL otherwise when saving information about the request to the `KeyValueCache`. Override this method to remove query parameters or compute a custom cache key.

For example, you could use this to use header fields or the HTTP method as part of the cache key. Even though we do validate header fields and don't serve responses from cache when they don't match, new responses overwrite old ones with different header fields. (For the HTTP method, this might be a positive thing, as you may want a `POST /foo` request to stop a previously cached `GET /foo` from being returned.)

##### `requestDeduplicationPolicyFor`

By default, `RESTDataSource` de-duplicates all **concurrent** outgoing **GET requests** in an in-memory cache, separate from the `KeyValueCache` used for the HTTP response cache. It makes the assumption that two HTTP GET requests to the same URL made in parallel can share the same response. When the GET request returns, its response is delivered to each caller that requested the same URL concurrently, and then it is removed from the cache.

If a request is made with the same cache key (URL by default) but with an HTTP method other than GET, deduplication of the in-flight request is invalidated: the next parallel `GET` request for the same URL will make a new request.

You can configure this behavior in several ways:
- You can change which requests are de-deduplicated and which are not.
- You can tell `RESTDataSource` to de-duplicate a request against new requests that start after it completes, not just overlapping requests. (This was the poorly-documented behavior of `RESTDataSource` prior to v5.0.0.)
- You can control the "deduplication key" independently from the `KeyValueCache` cache key.

You do this by overriding the `requestDeduplicationPolicyFor` method in your class. This method takes an URL and a request, and returns a policy object with one of three forms:

- `{policy: 'deduplicate-during-request-lifetime', deduplicationKey: string}`: This is the default behavior for GET requests. If a request with the same deduplication key is in progress, share its result. Otherwise, start a request, allow other requests to de-duplicate against it while it is running, and forget about it once the request returns successfully.
- `{policy: 'deduplicate-until-invalidated', deduplicationKey: string}`: This was the default behavior for GET requests in versions prior to v5. If a request with the same deduplication key is in progress, share its result. Otherwise, start a request and allow other requests to de-duplicate against it while it is running. All future requests with policy `deduplicate-during-request-lifetime` or `deduplicate-until-invalidated` with the same `deduplicationKey` will share the same result until a request is started with policy `do-not-deduplicate` and a matching entry in `invalidateDeduplicationKeys`.
- `{ policy: 'do-not-deduplicate'; invalidateDeduplicationKeys?: string[] }`: This is the default behavior for non-GET requests. Always run an actual HTTP request and don't allow other requests to de-duplicate against it. Additionally, invalidate any listed keys immediately: new requests with that `deduplicationKey` will not match any requests that currently exist in the request cache.

The default implementation of this method is:

```ts
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
This method is invoked at the beginning of processing each request. It's called
with the `path` and `request` provided to `fetch`, with a guaranteed non-empty
`headers` and `params` objects. If a `Promise` is returned from this method it
will wait until the promise is completed to continue executing the request. See
the [intercepting fetches](#intercepting-fetches) section for usage examples.

##### `cacheOptionsFor`
Allows setting the `CacheOptions` to be used for each request/response in the HTTPCache. This is separate from the request-only cache. You can use this to set the TTL to a value in seconds. If you return `{ttl: 0}`, the response will not be stored. If you return a positive number for `ttl` and the operation returns a 2xx status code, then the response *will* be cached, regardless of HTTP headers or method: make sure this is what you intended! (There is currently no way to say "only cache responses that should be cached according to HTTP headers, but change the TTL to something specific".) Note that if you do not specify `ttl` here, only `GET` requests are cached.

You can also specify `cacheOptions` as part of the "request" in any call to `get()`, `post()`, etc. This can either be an object such as `{ttl: 1}`, or a function returning that object. If `cacheOptions` is provided, `cacheOptionsFor` is not called (ie, `this.cacheOptionsFor` is effectively the default value of `cacheOptions`).

The `cacheOptions` function and `cacheOptionsFor` method may be async.

```javascript
override cacheOptionsFor() {
  return {
    ttl: 1
  }
}
```

##### `didEncounterError`
By default, this method just throws the `error` it was given. If you override this method, you can choose to either perform some additional logic and still throw, or to swallow the error by not throwing the error result.

#### `shouldJSONSerializeBody`
By default, this method returns `true` if the request body is:
- a plain object or an array
- an object with a `toJSON` method (which isn't a `Buffer` or an instance of a class named `FormData`)

You can override this method in order to serialize other objects such as custom classes as JSON.

### HTTP Methods

The `get` method on the [`RESTDataSource`](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) makes an HTTP `GET` request. Similarly, there are methods built-in to allow for `POST`, `PUT`, `PATCH`, and `DELETE` requests.

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

All of the HTTP helper functions (`get`, `put`, `post`, `patch`, and `delete`) accept a second parameter for setting the `body`, `headers`, `params`, `cacheKey`, and `cacheOptions`.

### Intercepting fetches

Data sources allow you to intercept fetches to set headers, query parameters, or make other changes to the outgoing request. This is most often used for authorization or other common concerns that apply to all requests. Data sources also get access to the GraphQL context, which is a great place to store a user token or other information you need to have available.

You can easily set a header on every request:

```javascript
class PersonalizationAPI extends RESTDataSource {
  willSendRequest(path, request) {
    request.headers['authorization'] = this.context.token;
  }
}
```

Or add a query parameter:

```javascript
class PersonalizationAPI extends RESTDataSource {
  willSendRequest(path, request) {
    request.params.set('api_key', this.context.token);
  }
}
```

If you're using TypeScript, you can use the `AugmentedRequest` type to define the `willSendRequest` signature:
```ts
import { RESTDataSource, AugmentedRequest } from '@apollo/datasource-rest';

class PersonalizationAPI extends RESTDataSource {
  override baseURL = 'https://personalization-api.example.com/';

  private token: string;
  constructor(options: { cache: KeyValueCache; token: string}) {
    super(options);
    this.token = options.token;
  }

  override willSendRequest(_path: string, request: AugmentedRequest) {
    request.headers['authorization'] = this.token;
  }
}
```

### Resolving URLs dynamically

In some cases, you'll want to set the URL based on the environment or other contextual values. To do this, you can override `resolveURL`:

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

### Accessing data sources from resolvers

To give resolvers access to data sources, you pass them as options to the `ApolloServer` constructor:

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

### Implementing custom metrics

By overriding `trace` method, it's possible to implement custom metrics for request timing.

See the original method [implementation](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) or the reference.
