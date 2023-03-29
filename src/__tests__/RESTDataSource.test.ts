import {
  type AugmentedRequest,
  type CacheOptions,
  type DataSourceConfig,
  type DataSourceFetchResult,
  type RequestDeduplicationPolicy,
  type RequestOptions,
  RESTDataSource,
} from '../RESTDataSource';

import FormData from 'form-data';
import { GraphQLError } from 'graphql';
import nock from 'nock';
import { nockAfterEach, nockBeforeEach } from './nockAssertions';
import type { WithRequired } from '@apollo/utils.withrequired';
import { Headers as NodeFetchHeaders } from 'node-fetch';

const apiUrl = 'https://api.example.com';

describe('RESTDataSource', () => {
  beforeEach(nockBeforeEach);
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
        override async resolveURL(path: string, request: AugmentedRequest) {
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

        override willSendRequest(_path: string, request: AugmentedRequest) {
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

        override willSendRequest(_path: string, request: AugmentedRequest) {
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

        override willSendRequest(_path: string, request: AugmentedRequest) {
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

    it('contains only one Content-Type header when Content-Type already exists is application/json', async () => {
      const requestOptions = {
        headers: {
          'Content-Type': 'application/json',
        },
        body: { foo: 'bar' },
      };
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo() {
          return this.post('foo', requestOptions);
        }
      })();

      const spyOnHttpFetch = jest.spyOn(dataSource['httpCache'], 'fetch');

      nock(apiUrl)
        .post('/foo')
        .reply(200, { foo: 'bar' }, { 'Content-Type': 'application/json' });

      const data = await dataSource.postFoo();
      expect(spyOnHttpFetch.mock.calls[0][1]).toEqual({
        headers: { 'content-type': 'application/json' },
        body: '{"foo":"bar"}',
        method: 'POST',
        params: new URLSearchParams(),
      });
      expect(data).toEqual({ foo: 'bar' });
    });

    it('converts uppercase-containing headers to lowercase', async () => {
      const requestOptions = {
        headers: {
          'Content-Type': 'application/json',
          'Test-Header': 'foobar',
          'ANOTHER-TEST-HEADER': 'test2',
        },
        body: { foo: 'bar' },
      };
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo() {
          return this.post('foo', requestOptions);
        }
      })();

      const spyOnHttpFetch = jest.spyOn(dataSource['httpCache'], 'fetch');

      nock(apiUrl)
        .post('/foo')
        .reply(200, { foo: 'bar' }, { 'Content-Type': 'application/json' });

      const data = await dataSource.postFoo();
      expect(spyOnHttpFetch.mock.calls[0][1]).toEqual({
        headers: {
          'content-type': 'application/json',
          'test-header': 'foobar',
          'another-test-header': 'test2',
        },
        body: '{"foo":"bar"}',
        method: 'POST',
        params: new URLSearchParams(),
      });
      expect(data).toEqual({ foo: 'bar' });
    });

    it('adds an `application/json` content-type header when none is present', async () => {
      const requestOptions = {
        body: { foo: 'bar' },
      };
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo() {
          return this.post('foo', requestOptions);
        }
      })();

      const spyOnHttpFetch = jest.spyOn(dataSource['httpCache'], 'fetch');

      nock(apiUrl)
        .post('/foo')
        .reply(200, { foo: 'bar' }, { 'Content-Type': 'application/json' });

      const data = await dataSource.postFoo();
      expect(spyOnHttpFetch.mock.calls[0][1]).toEqual({
        headers: {
          'content-type': 'application/json',
        },
        body: '{"foo":"bar"}',
        method: 'POST',
        params: new URLSearchParams(),
      });
      expect(data).toEqual({ foo: 'bar' });
    });

    it('adds an `application/json` content header when no headers are passed in', async () => {
      const requestOptions = {
        body: { foo: 'bar' },
      };
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo() {
          return this.post('foo', requestOptions);
        }
      })();

      const spyOnHttpFetch = jest.spyOn(dataSource['httpCache'], 'fetch');

      nock(apiUrl)
        .post('/foo')
        .reply(200, { foo: 'bar' }, { 'Content-Type': 'application/json' });

      const data = await dataSource.postFoo();
      expect(spyOnHttpFetch.mock.calls[0][1]).toEqual({
        headers: {
          'content-type': 'application/json',
        },
        body: '{"foo":"bar"}',
        method: 'POST',
        params: new URLSearchParams(),
      });
      expect(data).toEqual({ foo: 'bar' });
    });

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

    it('does not serialize FormData', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo(foo: FormData) {
          return this.post('foo', { body: foo });
        }
      })();

      const form = new FormData();
      form.append('foo', 'bar');

      nock(apiUrl)
        .post('/foo', (body) => {
          expect(body).toMatch(
            'Content-Disposition: form-data; name="foo"\r\n\r\nbar\r\n',
          );
          return true;
        })
        .reply(200);

      await dataSource.postFoo(form);
    });

    it('does not serialize (but does include) string request bodies', async () => {
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        updateFoo(id: number, urlEncodedFoo: string) {
          return this.post(`foo/${id}`, {
            headers: { 'content-type': 'application/x-www-urlencoded' },
            body: urlEncodedFoo,
          });
        }
      })();

      nock(apiUrl)
        .post('/foo/1', (body) => {
          return body === 'id=1&name=bar';
        })
        .reply(200, 'ok', { 'content-type': 'text/plain' });

      await dataSource.updateFoo(1, 'id=1&name=bar');
    });

    it('does not serialize (but does include) `Buffer` request bodies', async () => {
      const expectedData = 'id=1&name=bar';
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        updateFoo(id: number, fooBuf: Buffer) {
          return this.post(`foo/${id}`, {
            headers: { 'content-type': 'application/octet-stream' },
            body: fooBuf,
          });
        }
      })();

      nock(apiUrl)
        .post('/foo/1', (body) => {
          return body === expectedData;
        })
        .reply(200, 'ok', { 'content-type': 'text/plain' });

      await dataSource.updateFoo(1, Buffer.from(expectedData));
    });

    it('serializes a request body that is an object with a null prototype', async () => {
      interface Foo {
        hello: string;
      }
      const dataSource = new (class extends RESTDataSource {
        override baseURL = 'https://api.example.com';

        postFoo(foo: Foo) {
          return this.post('foo', { body: foo });
        }
      })();

      const foo: Foo = Object.create(null);
      foo.hello = 'world';

      nock(apiUrl).post('/foo', { hello: 'world' }).reply(200);

      await dataSource.postFoo(foo);
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

        headFoo() {
          return this.head('foo');
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

      it('HEAD', async () => {
        nock(apiUrl).head('/foo').reply(200);

        const response = await dataSource.headFoo();

        expect(response.status).toEqual(200);
      });
    });

    describe('HEAD requests', () => {
      it('Deduplicates HEAD requests', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = apiUrl;

          headFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'HEAD' });
          }
        })();

        nock(apiUrl).head('/foo/1').reply(200);

        const [r1, r2] = await Promise.all([
          dataSource.headFoo(1),
          dataSource.headFoo(1),
        ]);
        expect(r1.requestDeduplication).toMatchInlineSnapshot(`
          {
            "deduplicatedAgainstPreviousRequest": false,
            "policy": {
              "deduplicationKey": "HEAD https://api.example.com/foo/1",
              "policy": "deduplicate-during-request-lifetime",
            },
          }
        `);
        expect(r2.requestDeduplication).toMatchInlineSnapshot(`
          {
            "deduplicatedAgainstPreviousRequest": true,
            "policy": {
              "deduplicationKey": "HEAD https://api.example.com/foo/1",
              "policy": "deduplicate-during-request-lifetime",
            },
          }
        `);
      });

      it('Does not cache HEAD results', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = apiUrl;

          headFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'HEAD' });
          }
        })();

        nock(apiUrl).head('/foo/1').reply(200);
        nock(apiUrl).head('/foo/1').reply(200);

        const { httpCache } = await dataSource.headFoo(1);
        expect(httpCache.cacheWritePromise).toBeUndefined();
        await dataSource.headFoo(1);
      });

      it('Does not cache HEAD results even when TTL override is provided', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = apiUrl;

          headFoo(id: number) {
            return this.fetch(`foo/${id}`, {
              method: 'HEAD',
              cacheOptions: { ttl: 3000 },
            });
          }
        })();

        nock(apiUrl).head('/foo/1').reply(200);
        nock(apiUrl).head('/foo/1').reply(200);

        const { httpCache } = await dataSource.headFoo(1);
        expect(httpCache.cacheWritePromise).toBeUndefined();
        await dataSource.headFoo(1);
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

    describe('deduplication', () => {
      function expectResult(r: DataSourceFetchResult<unknown>) {
        return expect({
          parsedBody: r.parsedBody,
          requestDeduplication: r.requestDeduplication,
        });
      }
      it('de-duplicates simultaneous requests with the same cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'GET' });
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200, { hi: 42 });

        const [r1, r2] = await Promise.all([
          dataSource.getFoo(1),
          dataSource.getFoo(1),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "hi": 42,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "hi": 42,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": true,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
      });

      it('does not de-duplicate sequential requests with the same cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'GET' });
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200, { hi: 42 });
        nock(apiUrl).get('/foo/1').reply(200, { hi: 43 });
        const r1 = await dataSource.getFoo(1);
        const r2 = await dataSource.getFoo(1);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "hi": 42,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "hi": 43,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
      });

      it('de-duplicates sequential requests with the same cache key with policy deduplicate-until-invalidated', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          protected override requestDeduplicationPolicyFor(
            url: URL,
            request: WithRequired<RequestOptions, 'method'>,
          ): RequestDeduplicationPolicy {
            const p = super.requestDeduplicationPolicyFor(url, request);
            return p.policy === 'deduplicate-during-request-lifetime'
              ? {
                  policy: 'deduplicate-until-invalidated',
                  deduplicationKey: p.deduplicationKey,
                }
              : p;
          }

          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200, { hi: 42 });
        const r1 = await dataSource.getFoo(1);
        const r2 = await dataSource.getFoo(1);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "hi": 42,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-until-invalidated",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "hi": 42,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": true,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-until-invalidated",
              },
            },
          }
        `);
      });

      it('does not deduplicate requests with a different cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200, { foo: 1 });
        nock(apiUrl).get('/foo/2').reply(200, { foo: 2 });

        const [r1, r2] = await Promise.all([
          dataSource.getFoo(1),
          dataSource.getFoo(2),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "foo": 1,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "foo": 2,
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/2",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
      });

      it('returns a copy of the results and not a reference in case of modification', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          async getFoo(id: number) {
            const result = await this.fetch<{ foo: object[] }>(`foo/${id}`);
            result.parsedBody.foo.shift();
            expect(result.parsedBody.foo.length).toEqual(1);
            return result;
          }
        })();

        nock(apiUrl)
          .get('/foo/1')
          .reply(200, { foo: [{}, {}] });

        const [r1, r2] = await Promise.all([
          dataSource.getFoo(1),
          dataSource.getFoo(1),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "foo": [
                {},
              ],
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": {
              "foo": [
                {},
              ],
            },
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": true,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
      });

      it('does not deduplicate non-GET requests by default', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          postFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'POST' });
          }
        })();

        nock(apiUrl).post('/foo/1').reply(200);
        nock(apiUrl).post('/foo/1').reply(200);

        const [r1, r2] = await Promise.all([
          dataSource.postFoo(1),
          dataSource.postFoo(1),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "invalidateDeduplicationKeys": [
                  "GET https://api.example.com/foo/1",
                  "HEAD https://api.example.com/foo/1",
                ],
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "invalidateDeduplicationKeys": [
                  "GET https://api.example.com/foo/1",
                  "HEAD https://api.example.com/foo/1",
                ],
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
      });

      it('non-GET request invalidates deduplication of request with the same cache key', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'GET' });
          }

          postFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'POST' });
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        nock(apiUrl).post('/foo/1').reply(200);
        nock(apiUrl).get('/foo/1').reply(200);

        const [r1, r2, r3] = await Promise.all([
          dataSource.getFoo(1),
          dataSource.postFoo(1),
          dataSource.getFoo(1),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "invalidateDeduplicationKeys": [
                  "GET https://api.example.com/foo/1",
                  "HEAD https://api.example.com/foo/1",
                ],
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
        expectResult(r3).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
      });

      it('non-GET request invalidates deduplication of request with the same cache key with deduplicate-until-invalidated', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          protected override requestDeduplicationPolicyFor(
            url: URL,
            request: WithRequired<RequestOptions, 'method'>,
          ): RequestDeduplicationPolicy {
            const p = super.requestDeduplicationPolicyFor(url, request);
            return p.policy === 'deduplicate-during-request-lifetime'
              ? {
                  policy: 'deduplicate-until-invalidated',
                  deduplicationKey: p.deduplicationKey,
                }
              : p;
          }

          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }

          postFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'POST' });
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        nock(apiUrl).post('/foo/1').reply(200);
        nock(apiUrl).get('/foo/1').reply(200);

        const r1 = await dataSource.getFoo(1);
        const r2 = await dataSource.postFoo(1);
        const r3 = await dataSource.getFoo(1);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-until-invalidated",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "invalidateDeduplicationKeys": [
                  "GET https://api.example.com/foo/1",
                  "HEAD https://api.example.com/foo/1",
                ],
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
        expectResult(r3).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-until-invalidated",
              },
            },
          }
        `);
      });

      it('HEAD request does not invalidate deduplication of request with the same cache key with deduplicate-until-invalidated', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          protected override requestDeduplicationPolicyFor(
            url: URL,
            request: WithRequired<RequestOptions, 'method'>,
          ): RequestDeduplicationPolicy {
            const p = super.requestDeduplicationPolicyFor(url, request);
            return p.policy === 'deduplicate-during-request-lifetime'
              ? {
                  policy: 'deduplicate-until-invalidated',
                  deduplicationKey: p.deduplicationKey,
                }
              : p;
          }

          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }

          headFoo(id: number) {
            return this.fetch(`foo/${id}`, { method: 'HEAD' });
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        nock(apiUrl).head('/foo/1').reply(200);

        const r1 = await dataSource.getFoo(1);
        const r2 = await dataSource.headFoo(1);
        const r3 = await dataSource.getFoo(1);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-until-invalidated",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "HEAD https://api.example.com/foo/1",
                "policy": "deduplicate-until-invalidated",
              },
            },
          }
        `);
        expectResult(r3).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": true,
              "policy": {
                "deduplicationKey": "GET https://api.example.com/foo/1",
                "policy": "deduplicate-until-invalidated",
              },
            },
          }
        `);
      });

      it('allows specifying a custom cache key via cacheKeyFor', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          override cacheKeyFor(url: URL, _request: RequestOptions) {
            const urlNoSearchParams = new URL(url.toString());
            urlNoSearchParams.search = '';
            return urlNoSearchParams.toString();
          }

          getFoo(id: number, apiKey: string) {
            return this.fetch(`foo/${id}`, {
              params: { api_key: apiKey },
            });
          }
        })();

        nock(apiUrl).get('/foo/1').query({ api_key: 'secret' }).reply(200);

        const [r1, r2] = await Promise.all([
          dataSource.getFoo(1, 'secret'),
          dataSource.getFoo(1, 'anotherSecret'),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": true,
              "policy": {
                "deduplicationKey": "https://api.example.com/foo/1",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
      });

      it('allows specifying a custom cache key via cacheKey used for deduplication', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number) {
            return this.fetch(`foo/${id}`, {
              cacheKey: 'constant',
            });
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);

        const [r1, r2] = await Promise.all([
          dataSource.getFoo(1),
          dataSource.getFoo(2),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "deduplicationKey": "constant",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": true,
              "policy": {
                "deduplicationKey": "constant",
                "policy": "deduplicate-during-request-lifetime",
              },
            },
          }
        `);
      });

      it('allows specifying a custom cache key via cacheKey used for HTTP-header-sensitive cache', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          protected override requestDeduplicationPolicyFor() {
            return { policy: 'do-not-deduplicate' } as const;
          }

          getFoo(id: number) {
            return this.fetch(`foo/${id}`, {
              cacheKey: 'constant',
            });
          }
        })();

        nock(apiUrl)
          .get('/foo/1')
          .reply(200, '{}', { 'cache-control': 'max-age=60' });

        const r1 = await dataSource.getFoo(1);
        const r2 = await dataSource.getFoo(2);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "{}",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "{}",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
      });

      it('allows disabling deduplication', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          protected override requestDeduplicationPolicyFor() {
            return { policy: 'do-not-deduplicate' } as const;
          }

          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        nock(apiUrl).get('/foo/1').reply(200);

        // Expect two calls to pass
        const [r1, r2] = await Promise.all([
          dataSource.getFoo(1),
          dataSource.getFoo(1),
        ]);
        expectResult(r1).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
        expectResult(r2).toMatchInlineSnapshot(`
          {
            "parsedBody": "",
            "requestDeduplication": {
              "deduplicatedAgainstPreviousRequest": false,
              "policy": {
                "policy": "do-not-deduplicate",
              },
            },
          }
        `);
      });
    });

    describe('error handling', () => {
      it('can throw on 200 with throwIfResponseIsError', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }

          protected override async throwIfResponseIsError(
            options: Parameters<RESTDataSource['throwIfResponseIsError']>[0],
          ): Promise<void> {
            throw await this.errorFromResponse(options);
          }
        })();

        nock(apiUrl).get('/foo').reply(200, 'Invalid token');

        const result = dataSource.getFoo();
        await expect(result).rejects.toThrow(GraphQLError);
        await expect(result).rejects.toMatchObject({
          extensions: {
            response: {
              status: 200,
              body: 'Invalid token',
            },
          },
        });
      });

      it('throws an UNAUTHENTICATED error when the response status is 401', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl).get('/foo').reply(401, 'Invalid token');

        const result = dataSource.getFoo();
        await expect(result).rejects.toThrow(GraphQLError);
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

      it('throws a FORBIDDEN error when the response status is 403', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo() {
            return this.get('foo');
          }
        })();

        nock(apiUrl).get('/foo').reply(403, 'No access');

        const result = dataSource.getFoo();
        await expect(result).rejects.toThrow(GraphQLError);
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
      // Skipping due to https://github.com/apollographql/datasource-rest/issues/102
      it.skip('caches 301 responses', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(301, '', {
          location: 'https://api.example.com/foo/2',
          'cache-control': 'public, max-age=31536000, immutable',
        });
        nock(apiUrl).get('/foo/2').reply(200);
        const { httpCache } = await dataSource.getFoo(1);
        expect(httpCache.cacheWritePromise).toBeDefined();
        await httpCache.cacheWritePromise;

        // Call a second time which should be cached
        await dataSource.getFoo(1);
      });

      it('does not cache 302 responses', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }
        })();

        nock(apiUrl).get('/foo/1').reply(302, '', {
          location: 'https://api.example.com/foo/2',
          'cache-control': 'public, max-age=31536000, immutable',
        });
        nock(apiUrl).get('/foo/2').reply(200);
        const { httpCache } = await dataSource.getFoo(1);
        expect(httpCache.cacheWritePromise).toBeUndefined();

        // Call a second time which should NOT be cached (it's a temporary redirect!).
        nock(apiUrl).get('/foo/1').reply(302, '', {
          location: 'https://api.example.com/foo/2',
          'cache-control': 'public, max-age=31536000, immutable',
        });
        nock(apiUrl).get('/foo/2').reply(200);
        await dataSource.getFoo(1);
      });

      it('allows setting cache options for each request', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          protected override requestDeduplicationPolicyFor() {
            return { policy: 'do-not-deduplicate' } as const;
          }

          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }

          // Set a long TTL for every request
          override cacheOptionsFor(): CacheOptions | undefined {
            return {
              ttl: 1000000,
            };
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        const { httpCache } = await dataSource.getFoo(1);
        expect(httpCache.cacheWritePromise).toBeDefined();
        await httpCache.cacheWritePromise;

        // Call a second time which should be cached
        await dataSource.getFoo(1);
      });

      it('allows setting a short TTL for the cache', async () => {
        // nock depends on process.nextTick
        jest.useFakeTimers({ doNotFake: ['nextTick'] });

        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';
          protected override requestDeduplicationPolicyFor() {
            return { policy: 'do-not-deduplicate' } as const;
          }

          getFoo(id: number) {
            return this.fetch(`foo/${id}`);
          }

          // Set a short TTL for every request
          override async cacheOptionsFor(): Promise<CacheOptions | undefined> {
            return {
              ttl: 1,
            };
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200);
        const { httpCache } = await dataSource.getFoo(1);
        expect(httpCache.cacheWritePromise).toBeDefined();
        await httpCache.cacheWritePromise;

        // expire the cache (note: 999ms, just shy of the 1s ttl, will reliably fail this test)
        jest.advanceTimersByTime(1000);

        // Call a second time which should be invalid now
        await expect(dataSource.getFoo(1)).rejects.toThrow();

        jest.useRealTimers();
      });

      it('allows options to be passed to http-cache-semantics', async () => {
        const dataSource = new (class extends RESTDataSource {
          override baseURL = 'https://api.example.com';

          getFoo(id: number, shared: boolean) {
            return this.fetch(`foo/${id}`, {
              httpCacheSemanticsCachePolicyOptions: { shared },
            });
          }
        })();

        nock(apiUrl).get('/foo/1').reply(200, '{}', {
          'Cache-Control': 'max-age=60,must-revalidate',
          'set-cookie':
            'whatever=blah; expires=Mon, 01-Jan-2050 00:00:00 GMT; path=/; domain=www.example.com',
        });
        const { httpCache } = await dataSource.getFoo(1, false);
        expect(httpCache.cacheWritePromise).toBeDefined();
        await httpCache.cacheWritePromise;
        // Call a second time which should be cached despite `set-cookie` due to
        // `shared: false`.
        await dataSource.getFoo(1, false);

        nock(apiUrl).get('/foo/2').times(2).reply(200, '{}', {
          'Cache-Control': 'max-age=60,must-revalidate',
          'set-cookie':
            'whatever=blah; expires=Mon, 01-Jan-2050 00:00:00 GMT; path=/; domain=www.example.com',
        });
        expect(
          await (
            await dataSource.getFoo(2, true)
          ).httpCache.cacheWritePromise,
        ).toBeUndefined();
        // Call a second time which should be not be cached because of
        // `set-cookie` with `shared: true`. (Note the `.times(2)` above.)
        await dataSource.getFoo(2, true);
      });

      describe('raw header access when using node-fetch', () => {
        it('for a non-cacheable request', async () => {
          const dataSource = new (class extends RESTDataSource {
            override baseURL = 'https://api.example.com';

            postFoo() {
              return this.fetch('foo', { method: 'POST' });
            }
          })();

          nock(apiUrl)
            .post('/foo')
            .reply(200, '{}', {
              hello: 'dolly, world',
              'set-cookie': ['first=foo', 'second=bar'],
            });
          const { response, httpCache } = await dataSource.postFoo();
          expect(httpCache.cacheWritePromise).toBeUndefined();
          const { headers } = response;
          expect(headers.get('hello')).toBe('dolly, world');
          // The general Fetcher interface only lets you get the combined header values.
          expect(headers.get('set-cookie')).toBe('first=foo, second=bar');

          if (!(headers instanceof NodeFetchHeaders)) {
            fail(
              'headers should be a NodeFetchHeaders when fetcher not overridden',
            );
          }
          expect(headers.raw()['hello']).toStrictEqual(['dolly, world']);
          expect(headers.raw()['set-cookie']).toStrictEqual([
            'first=foo',
            'second=bar',
          ]);
        });

        it('for a cacheable but not de-duped request', async () => {
          const dataSource = new (class extends RESTDataSource {
            override baseURL = 'https://api.example.com';

            postFoo() {
              return this.fetch('foo', {
                method: 'POST',
                cacheOptions: { ttl: 60 },
              });
            }
          })();

          nock(apiUrl)
            .post('/foo')
            .reply(200, '{}', {
              hello: 'dolly, world',
              'set-cookie': ['first=foo', 'second=bar'],
            });

          // First time: does HTTP then writes to cache.
          {
            const { response, httpCache } = await dataSource.postFoo();
            expect(httpCache.cacheWritePromise).toBeDefined();
            const { headers } = response;
            expect(headers.get('hello')).toBe('dolly, world');
            // The general Fetcher interface only lets you get the combined header values.
            expect(headers.get('set-cookie')).toBe('first=foo, second=bar');

            if (!(headers instanceof NodeFetchHeaders)) {
              fail(
                'headers should be a NodeFetchHeaders when fetcher not overridden',
              );
            }
            expect(headers.raw()['hello']).toStrictEqual(['dolly, world']);
            expect(headers.raw()['set-cookie']).toStrictEqual([
              'first=foo',
              'second=bar',
            ]);
            await httpCache.cacheWritePromise;
          }

          // Second time: reads from cache.
          {
            const { response, httpCache } = await dataSource.postFoo();
            expect(httpCache.cacheWritePromise).toBeUndefined();
            const { headers } = response;
            expect(headers.get('hello')).toBe('dolly, world');
            // The general Fetcher interface only lets you get the combined header values.
            expect(headers.get('set-cookie')).toBe('first=foo, second=bar');

            if (!(headers instanceof NodeFetchHeaders)) {
              fail(
                'headers should be a NodeFetchHeaders when fetcher not overridden',
              );
            }
            expect(headers.raw()['hello']).toStrictEqual(['dolly, world']);
            expect(headers.raw()['set-cookie']).toStrictEqual([
              'first=foo',
              'second=bar',
            ]);
          }
        });
      });
    });

    describe('user hooks', () => {
      describe('willSendRequest', () => {
        const obj = { foo: 'bar' };
        const str = 'foo=bar';
        const buffer = Buffer.from(str);

        it.each([
          ['object', obj, obj],
          ['string', str, str],
          ['buffer', buffer, str],
        ])(`can set the body to a %s`, async (_, body, expected) => {
          const dataSource = new (class extends RESTDataSource {
            override baseURL = apiUrl;

            updateFoo(id: number, foo: string | Buffer | { foo: string }) {
              return this.post(`foo/${id}`, { body: foo });
            }

            override async willSendRequest(
              path: string,
              requestOpts: AugmentedRequest,
            ) {
              expect(path).toMatch('foo/1');
              expect(requestOpts.body).toEqual(body);
            }
          })();

          nock(apiUrl).post('/foo/1', expected).reply(200);
          await dataSource.updateFoo(1, body);
        });

        it('is called with the correct path', async () => {
          const dataSource = new (class extends RESTDataSource {
            override baseURL = apiUrl;

            updateFoo(id: number, foo: { foo: string }) {
              return this.post(`foo/${id}`, { body: foo });
            }

            override async willSendRequest(
              path: string,
              _requestOpts: AugmentedRequest,
            ) {
              expect(path).toMatch('foo/1');
            }
          })();

          nock(apiUrl).post('/foo/1', obj).reply(200);
          await dataSource.updateFoo(1, obj);
        });
      });

      describe('resolveURL', () => {
        it('sees the same request body as provided by the caller', async () => {
          const dataSource = new (class extends RESTDataSource {
            override baseURL = apiUrl;

            updateFoo(id: number, foo: { name: string }) {
              return this.post(`foo/${id}`, { body: foo });
            }

            override resolveURL(path: string, requestOpts: AugmentedRequest) {
              expect(requestOpts.body).toMatchInlineSnapshot(`
                {
                  "name": "blah",
                }
              `);
              return super.resolveURL(path, requestOpts);
            }
          })();

          nock(apiUrl)
            .post('/foo/1', JSON.stringify({ name: 'blah' }))
            .reply(200);
          await dataSource.updateFoo(1, { name: 'blah' });
        });
      });

      describe('shouldJSONSerializeBody', () => {
        it('can be overridden', async () => {
          let calls = 0;
          const dataSource = new (class extends RESTDataSource {
            override baseURL = apiUrl;

            updateFoo(id: number, foo: { name: string }) {
              return this.post(`foo/${id}`, { body: foo });
            }

            override shouldJSONSerializeBody(
              body: string | object | Buffer | undefined,
            ) {
              calls++;
              return super.shouldJSONSerializeBody(body);
            }
          })();

          nock(apiUrl).post('/foo/1', { name: 'bar' }).reply(200);
          await dataSource.updateFoo(1, { name: 'bar' });
          expect(calls).toBe(1);
        });
      });

      describe('didEncounterError', () => {
        it('is called with the error', async () => {
          let encounteredError: Error | null = null;
          const dataSource = new (class extends RESTDataSource {
            override baseURL = 'https://api.example.com';

            getFoo() {
              return this.get('foo');
            }

            override didEncounterError(error: Error) {
              encounteredError = error;
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
          expect(encounteredError).toMatchObject({
            message: '500: Internal Server Error',
          });
        });

        it('can modify the error', async () => {
          const dataSource = new (class extends RESTDataSource {
            override baseURL = 'https://api.example.com';

            getFoo() {
              return this.get('foo');
            }

            override didEncounterError(error: Error) {
              error.message = 'Hello from didEncounterError';
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
            message: 'Hello from didEncounterError',
          });
        });

        it('can throw its own error', async () => {
          const dataSource = new (class extends RESTDataSource {
            override baseURL = 'https://api.example.com';

            getFoo() {
              return this.get('foo');
            }

            override didEncounterError() {
              throw new Error('I replaced the error entirely');
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

          await expect(result).rejects.not.toThrow(GraphQLError);
          await expect(result).rejects.toThrow(Error);
          await expect(result).rejects.toMatchObject({
            message: 'I replaced the error entirely',
          });
        });
      });
    });
  });
});
