// import fetch, { Request } from 'node-fetch';
import {
  AuthenticationError,
  CacheOptions,
  DataSourceConfig,
  ForbiddenError,
  RequestOptions,
  RESTDataSource,
  WillSendRequestOptions,
  // RequestOptions
} from '../RESTDataSource';

// import { HTTPCache } from '../HTTPCache';
// import { MapKeyValueCache } from './MapKeyValueCache';
import { nockAfterEach, nockBeforeEach } from './nockAssertions';
import nock from 'nock';
import { GraphQLError } from 'graphql';

const apiUrl = 'https://api.example.com';

describe('RESTDataSource', () => {
  // let httpCache: HTTPCache;

  beforeEach(() => {
    nockBeforeEach();
    // httpCache = new HTTPCache(new MapKeyValueCache<string>());
  });

  afterEach(nockAfterEach);

  describe('constructing requests', () => {
    it('interprets paths relative to the base URL', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = apiUrl;

        getFoo() {
          return this.get('foo');
        }
      })();

      nock(apiUrl).get('/foo').reply(200, {});

      await dataSource.getFoo();
    });

    it('interprets paths with a leading slash relative to the base URL', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = `${apiUrl}/bar`;

        getFoo() {
          return this.get('/foo');
        }
      })();

      nock(apiUrl).get('/foo').reply(200, {});

      await dataSource.getFoo();
    });

    it('does not automatically adds a trailing slash to the base URL', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = `${apiUrl}/api`;

        getFoo() {
          return this.get('foo');
        }
      })();

      nock(apiUrl).get('/foo').reply(200, {});

      await dataSource.getFoo();
    });

    it('works as expected when the base URL has a trailing slash', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = `${apiUrl}/api/`;

        getFoo() {
          return this.get('foo');
        }
      })();

      nock(apiUrl).get('/api/foo').reply(200, {});

      await dataSource.getFoo();
    });

    it('can use a whole new URL, overriding baseURL', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = `${apiUrl}/api/`;

        getFoo() {
          return this.get('https://different-api.example.com/foo/bar');
        }
      })();

      nock('https://different-api.example.com').get('/foo/bar').reply(200, {});

      await dataSource.getFoo();
    });

    it.each([
      ['', './urn:foo:1', '/urn:foo:1'],
      ['/api/', './urn:foo:1', '/api/urn:foo:1'],
      ['', '/urn:foo:1', '/urn:foo:1'],
      ['/api/', '/urn:foo:1', '/urn:foo:1'],
    ])(
      'supports paths with colons near the beginning (base URL path=%p, passed path=%p)',
      async (baseURLPath, passedPath, nockPath) => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = `${apiUrl}${baseURLPath}`;

          getFoo() {
            return this.get(passedPath);
          }
        })();

        nock(apiUrl).get(nockPath).reply(200, {});

        await dataSource.getFoo();
      },
    );

    it('allows resolving a base URL asynchronously', async () => {
      const dataSource = new (class extends RESTDataSource {
        override async resolveURL(path: string, request: RequestOptions) {
          if (!this.baseURL) {
            this.baseURL = 'https://api.example.com';
          }
          return super.resolveURL(path, request);
        }

        getFoo() {
          return this.get('foo');
        }
      })();

      nock(apiUrl).get('/foo').reply(200, {});

      await dataSource.getFoo();
    });

    it('allows passing in query string parameters', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        getPostsForUser(
          username: string,
          params: {
            filter: string;
            limit: number;
            offset: number;
            optional?: string;
          },
        ) {
          return this.get('posts', {
            params: {
              username,
              filter: params.filter,
              limit: params.limit.toString(),
              offset: params.offset.toString(),
              // In the test, this is undefined and should not end up in the URL.
              optional: params.optional,
            },
          });
        }

        getPostsWithURLSearchParams(username: string) {
          return this.get('posts2', {
            params: new URLSearchParams([['username', username]]),
          });
        }
      })();

      nock(apiUrl)
        .get('/posts')
        .query({
          username: 'beyoncé',
          filter: 'jalapeño',
          limit: 10,
          offset: 20,
        })
        .reply(200);

      nock(apiUrl)
        .get('/posts2')
        .query({
          username: 'beyoncé',
        })
        .reply(200);

      await dataSource.getPostsForUser('beyoncé', {
        filter: 'jalapeño',
        limit: 10,
        offset: 20,
      });
      await dataSource.getPostsWithURLSearchParams('beyoncé');
    });

    it('allows setting default query string parameters', async () => {
      class AuthedDataSource extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        constructor(private token: string, config?: DataSourceConfig) {
          super(config);
        }

        override willSendRequest(request: WillSendRequestOptions) {
          request.params.set('apiKey', this.token);
        }

        getFoo(id: string) {
          return this.get('foo', { params: { id } });
        }
      }

      const dataSource = new AuthedDataSource('secret');

      nock(apiUrl).get('/foo').query({ id: '1', apiKey: 'secret' }).reply(200);

      await dataSource.getFoo('1');
    });

    it('allows setting default fetch options', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        override willSendRequest(request: WillSendRequestOptions) {
          request.headers = { ...request.headers, credentials: 'include' };
        }

        getFoo() {
          return this.get('foo');
        }
      })();

      nock(apiUrl).get('/foo').matchHeader('credentials', 'include').reply(200);

      await dataSource.getFoo();
    });

    it('allows setting request headers', async () => {
      class AuthedDataSource extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        constructor(private token: string, config?: DataSourceConfig) {
          super(config);
        }

        override willSendRequest(request: WillSendRequestOptions) {
          request.headers = { ...request.headers, authorization: this.token };
        }

        getFoo(id: string) {
          return this.get('foo', { params: { id } });
        }
      }

      const dataSource = new AuthedDataSource('secret');

      nock(apiUrl)
        .get('/foo')
        .query({ id: '1' })
        .matchHeader('authorization', 'secret')
        .reply(200);

      await dataSource.getFoo('1');
    });

    //   function expectJSONFetch(url: string, bodyJSON: unknown) {
    //     expect(fetch).toBeCalledTimes(1);
    //     const request = fetch.mock.calls[0][0] as Request;
    //     expect(request.url).toEqual(url);
    //     // request.body is a node-fetch extension which we aren't properly
    //     // capturing in our TS types.
    //     expect((request as any).body.toString()).toEqual(
    //       JSON.stringify(bodyJSON),
    //     );
    //     expect(request.headers.get('Content-Type')).toEqual('application/json');
    //   }

    it('serializes a request body that is an object as JSON', async () => {
      const expectedFoo = { foo: 'bar' };
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo(foo: object) {
          return this.post('foo', { body: foo });
        }
      })();

      nock(apiUrl)
        .post('/foo', expectedFoo)
        .matchHeader('content-type', 'application/json')
        .reply(200);

      await dataSource.postFoo(expectedFoo);
    });

    it('serializes a request body that is an array as JSON', async () => {
      const expected = ['foo', 'bar'];
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo(foo: string[]) {
          return this.post('foo', { body: foo });
        }
      })();

      nock(apiUrl)
        .post('/foo', expected)
        .matchHeader('content-type', 'application/json')
        .reply(200);

      await dataSource.postFoo(expected);
    });

    it('serializes a request body that has a toJSON method as JSON', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo(foo: Model) {
          return this.post('foo', { body: foo });
        }
      })();

      class Model {
        constructor(public baz: any) {}

        toJSON() {
          return {
            foo: this.baz,
          };
        }
      }
      const model = new Model('bar');

      nock(apiUrl)
        .post('/foo', { foo: 'bar' })
        .matchHeader('content-type', 'application/json')
        .reply(200);

      await dataSource.postFoo(model);
    });

    it('does not serialize a request body that is not an object', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo(foo: FormData) {
          return this.post('foo', { body: foo });
        }
      })();

      class FormData {}
      const form = new FormData();

      nock(apiUrl).post('/foo').reply(200);

      await dataSource.postFoo(form);
    });

    describe('all methods', () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        getFoo() {
          return this.get('foo');
        }

        postFoo() {
          return this.post('foo');
        }

        patchFoo() {
          return this.patch('foo');
        }

        putFoo() {
          return this.put('foo');
        }

        deleteFoo() {
          return this.delete('foo');
        }
      })();

      const expectedFoo = { foo: 'bar' };

      it('GET', async () => {
        nock(apiUrl).get('/foo').reply(200, expectedFoo);

        const data = await dataSource.getFoo();

        expect(data).toEqual(expectedFoo);
      });

      it('POST', async () => {
        nock(apiUrl).post('/foo').reply(200, expectedFoo);

        const data = await dataSource.postFoo();

        expect(data).toEqual(expectedFoo);
      });

      it('PATCH', async () => {
        nock(apiUrl).patch('/foo').reply(200, expectedFoo);

        const data = await dataSource.patchFoo();

        expect(data).toEqual(expectedFoo);
      });

      it('PUT', async () => {
        nock(apiUrl).put('/foo').reply(200, expectedFoo);

        const data = await dataSource.putFoo();

        expect(data).toEqual(expectedFoo);
      });

      it('DELETE', async () => {
        nock(apiUrl).delete('/foo').reply(200, expectedFoo);

        const data = await dataSource.deleteFoo();

        expect(data).toEqual(expectedFoo);
      });
    });

    describe('response parsing', () => {
      it('returns data as parsed JSON when Content-Type is application/json', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl)
          .get('/foo')
          .reply(200, { foo: 'bar' }, { 'content-type': 'application/json' });

        const data = await dataSource.getFoo();

        expect(data).toEqual({ foo: 'bar' });
      });

      it('returns data as parsed JSON when Content-Type is application/hal+json', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl)
          .get('/foo')
          .reply(
            200,
            { foo: 'bar' },
            { 'content-type': 'application/hal+json' },
          );

        const data = await dataSource.getFoo();

        expect(data).toEqual({ foo: 'bar' });
      });

      it('returns data as parsed JSON when Content-Type ends in +json', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl)
          .get('/foo')
          .reply(
            200,
            { foo: 'bar' },
            { 'content-type': 'application/vnd.api+json' },
          );

        const data = await dataSource.getFoo();

        expect(data).toEqual({ foo: 'bar' });
      });

      it('returns data as a string when Content-Type is text/plain', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl)
          .get('/foo')
          .reply(200, 'bar', { 'content-type': 'text/plain' });

        const data = await dataSource.getFoo();

        expect(data).toEqual('bar');
      });

      it('attempts to return data as a string when no Content-Type header is returned', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl).get('/foo').reply(200, 'bar');

        const data = await dataSource.getFoo();

        expect(data).toEqual('bar');
      });

      it('returns data as a string when response status code is 204 no content', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('');
          }
        })();

        nock(apiUrl)
          .get('/')
          .reply(204, '', { 'content-type': 'application/json' });

        const data = await dataSource.getFoo();

        expect(data).toEqual('');
      });

      it('returns empty object when response content length is 0', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('');
          }
        })();

        nock(apiUrl).get('/').reply(200, '', {
          'content-type': 'application/json',
          'content-length': '0',
        });

        const data = await dataSource.getFoo();

        expect(data).toEqual('');
      });
    });

    describe('memoization/request cache', () => {
      it('de-duplicates requests with the same cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.get(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);

        await Promise.all([dataSource.getFoo(1), dataSource.getFoo(1)]);
      });

      it('does not deduplicate requests with a different cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.get(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        nock(apiUrl).get('/foo/2').reply(200);

        await Promise.all([dataSource.getFoo(1), dataSource.getFoo(2)]);
      });

      it('does not deduplicate non-GET requests', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          postFoo(id: number) {
            return this.post(`foo/${id}`);
          }
        })();

        nock(apiUrl).post('/foo/1').reply(200);
        nock(apiUrl).post('/foo/1').reply(200);

        await Promise.all([dataSource.postFoo(1), dataSource.postFoo(1)]);
      });

      it('non-GET request removes memoized request with the same cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.get(`foo/${id}`);
          }

          postFoo(id: number) {
            return this.post(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        nock(apiUrl).post('/foo/1').reply(200);
        nock(apiUrl).get('/foo/1').reply(200);

        await Promise.all([
          dataSource.getFoo(1),
          dataSource.postFoo(1),
          dataSource.getFoo(1),
        ]);
      });

      it('allows specifying a custom cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          override cacheKeyFor(url: URL, _request: RequestOptions) {
            const urlNoSearchParams = new URL(url);
            urlNoSearchParams.search = '';
            return urlNoSearchParams.toString();
          }

          getFoo(id: number, apiKey: string) {
            return this.get(`foo/${id}`, {
              params: { api_key: apiKey },
            });
          }
        })();

        nock(apiUrl).get('/foo/1').query({ api_key: 'secret' }).reply(200);

        await Promise.all([
          dataSource.getFoo(1, 'secret'),
          dataSource.getFoo(1, 'anotherSecret'),
        ]);
      });

      it('allows disabling the GET cache', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          override memoizeGetRequests = false;

          getFoo(id: number) {
            return this.get(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        nock(apiUrl).get('/foo/1').reply(200);

        // Expect two calls to pass
        await Promise.all([dataSource.getFoo(1), dataSource.getFoo(1)]);
      });
    });

    describe('error handling', () => {
      it('throws an AuthenticationError when the response status is 401', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl).get('/foo').reply(401, 'Invalid token');

        const result = dataSource.getFoo();
        await expect(result).rejects.toThrow(AuthenticationError);
        await expect(result).rejects.toMatchObject({
          extensions: {
            code: 'UNAUTHENTICATED',
            response: {
              status: 401,
              body: 'Invalid token',
            },
          },
        });
      });

      it('throws a ForbiddenError when the response status is 403', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl).get('/foo').reply(403, 'No access');

        const result = dataSource.getFoo();
        await expect(result).rejects.toThrow(ForbiddenError);
        await expect(result).rejects.toMatchObject({
          extensions: {
            code: 'FORBIDDEN',
            response: {
              status: 403,
              body: 'No access',
            },
          },
        });
      });

      it('throws an ApolloError when the response status is 500', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl).get('/foo').reply(500, 'Oops');

        const result = dataSource.getFoo();
        await expect(result).rejects.toThrow(GraphQLError);
        await expect(result).rejects.toMatchObject({
          extensions: {
            response: {
              status: 500,
              body: 'Oops',
            },
          },
        });
      });

      it('puts JSON error responses on the error as an object', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl)
          .get('/foo')
          .reply(
            500,
            {
              errors: [{ message: 'Houston, we have a problem.' }],
            },
            { 'content-type': 'application/json' },
          );

        const result = dataSource.getFoo();
        await expect(result).rejects.toThrow(GraphQLError);
        await expect(result).rejects.toMatchObject({
          extensions: {
            response: {
              status: 500,
              body: {
                errors: [
                  {
                    message: 'Houston, we have a problem.',
                  },
                ],
              },
            },
          },
        });
      });
    });

    describe('trace', () => {
      it('is called once per request', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        // @ts-ignore TS doesn't recognize the `trace` property on `RESTDataSource`
        const traceSpy = jest.spyOn(dataSource, 'trace');

        nock(apiUrl).get('/foo').reply(200);

        await dataSource.getFoo();

        expect(traceSpy).toBeCalledTimes(1);
        expect(traceSpy).toBeCalledWith(
          expect.any(URL),
          expect.any(Object),
          expect.any(Function),
        );
      });
    });

    describe('http cache', () => {
      it('allows setting cache options for each request', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          override memoizeGetRequests = false;

          getFoo(id: number) {
            return this.get(`foo/${id}`);
          }

          // Set a long TTL for every request
          override cacheOptionsFor(): CacheOptions | undefined {
            return {
              ttl: 1000000,
            };
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        await dataSource.getFoo(1);

        // Call a second time which should be cached
        await dataSource.getFoo(1);
      });

      it('allows setting a short TTL for the cache', async () => {
        // nock depends on process.nextTick
        jest.useFakeTimers({ doNotFake: ['nextTick'] });

        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          override memoizeGetRequests = false;

          getFoo(id: number) {
            return this.get(`foo/${id}`);
          }

          // Set a short TTL for every request
          override cacheOptionsFor(): CacheOptions | undefined {
            return {
              ttl: 1,
            };
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        await dataSource.getFoo(1);

        // expire the cache (note: 999ms, just shy of the 1s ttl, will reliably fail this test)
        jest.advanceTimersByTime(1000);

        // Call a second time which should be invalid now
        await expect(dataSource.getFoo(1)).rejects.toThrow();

        jest.useRealTimers();
      });
    });
  });
});
