# Apollo REST Data Source

This package exports a ([`RESTDataSource`](https://github.com/apollographql/datasource-rest#apollo-rest-data-source)) class which is used for fetching data from a REST API and exposing it via GraphQL within Apollo Server.

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
  constructor() {
    super();
    this.baseURL = 'https://movies-api.example.com/';
  }

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
  constructor() {
    super();
    this.baseURL = 'https://movies-api.example.com/';
  }
  // GET
  async getMovie(id) {
    return this.get(
      `movies/${encodeURIComponent(id)}` // path
    );
  }
}
```

##### `memoizeGetRequests`
By default, `RESTDataSource` caches all outgoing GET **requests** in a separate memoized cache from the regular response cache. It makes the assumption that all responses from HTTP GET calls are cacheable by their URL.
If a request is made with the same cache key (URL by default) but with an HTTP method other than GET, the cached request is then cleared.

If you would like to disable the GET request cache, set the `memoizeGetRequests` property to `false`. You might want to do this if your API is not actually cacheable or your data changes over time.

```js title="memoizeGetRequests.js"
class MoviesAPI extends RESTDataSource {
  constructor() {
    super();
    // Defaults to true
    this.memoizeGetRequests = false;
  }

  // Outgoing requests are never cached, however the response cache is still enabled
  async getMovie(id) {
    return this.get(
      `https://movies-api.example.com/movies/${encodeURIComponent(id)}` // path
    );
  }
}
```

#### Methods

##### `cacheKeyFor`
By default, `RESTDatasource` uses the full request URL as the cache key. Override this method to remove query parameters or compute a custom cache key.

For example, you could use this to use header fields as part of the cache key. Even though we do validate header fields and don't serve responses from cache when they don't match, new responses overwrite old ones with different header fields.

##### `willSendRequest`
This method is invoked just before the fetch call is made. If a `Promise` is returned from this method it will wait until the promise is completed to continue executing the request.

##### `cacheOptionsFor`
Allows setting the `CacheOptions` to be used for each request/response in the HTTPCache. This is separate from the request-only cache. You can use this to set the TTL.

```javascript
override cacheOptionsFor() {
  return {
    ttl: 1
  }
}
```

##### `didReceiveResponse`
By default, this method checks if the response was returned successfully and parses the response into the result object. If the response had an error, it detects which type of HTTP error and throws the error result.

If you override this behavior, be sure to implement the proper error handling.

##### `didEncounterError`
By default, this method just throws the `error` it was given. If you override this method, you can choose to either perform some additional logic and still throw, or to swallow the error by not throwing the error result.

### HTTP Methods

The `get` method on the [`RESTDataSource`](https://github.com/apollographql/datasource-rest/tree/main/src/RESTDataSource.ts) makes an HTTP `GET` request. Similarly, there are methods built-in to allow for `POST`, `PUT`, `PATCH`, and `DELETE` requests.

```javascript
class MoviesAPI extends RESTDataSource {
  constructor() {
    super();
    this.baseURL = 'https://movies-api.example.com/';
  }

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

All of the HTTP helper functions (`get`, `put`, `post`, `patch`, and `delete`) accept a second parameter for setting the `body`, `headers`, `params`, and `cacheOptions`.

### Intercepting fetches

Data sources allow you to intercept fetches to set headers, query parameters, or make other changes to the outgoing request. This is most often used for authorization or other common concerns that apply to all requests. Data sources also get access to the GraphQL context, which is a great place to store a user token or other information you need to have available.

You can easily set a header on every request:

```javascript
class PersonalizationAPI extends RESTDataSource {
  willSendRequest(request) {
    request.headers['authorization'] = this.context.token;
  }
}
```

Or add a query parameter:

```javascript
class PersonalizationAPI extends RESTDataSource {
  willSendRequest(request) {
    request.params.set('api_key', this.context.token);
  }
}
```

If you're using TypeScript, you can use the `RequestOptions` type to define the `willSendRequest` signature:
```ts
import { RESTDataSource, WillSendRequestOptions } from '@apollo/datasource-rest';

class PersonalizationAPI extends RESTDataSource {
  override baseURL = 'https://personalization-api.example.com/';

  constructor(private token: string) {
    super();
  }

  override willSendRequest(request: WillSendRequestOptions) {
    request.headers['authorization'] = this.token;
  }
}
```

### Resolving URLs dynamically

In some cases, you'll want to set the URL based on the environment or other contextual values. To do this, you can override `resolveURL`:

```ts
class PersonalizationAPI extends RESTDataSource {
  constructor(private token: string) {
    super();
  }

  override async resolveURL(path: string) {
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
