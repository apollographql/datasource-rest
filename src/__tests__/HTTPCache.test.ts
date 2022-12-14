import fetch from 'node-fetch';
import nock from 'nock';
import { HTTPCache } from '../HTTPCache';
import { nockAfterEach, nockBeforeEach } from './nockAssertions';
import { FakeableTTLTestingCache } from './FakeableTTLTestingCache';

describe('HTTPCache', () => {
  let store: FakeableTTLTestingCache;
  let httpCache: HTTPCache;

  beforeEach(() => {
    nockBeforeEach();
    store = new FakeableTTLTestingCache();
    httpCache = new HTTPCache(store, fetch);
  });

  afterEach(nockAfterEach);

  beforeAll(() => {
    // nock depends on process.nextTick (and we use it to make async functions actually async)
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const apiUrl = 'https://api.example.com';
  const adaPath = '/people/1';
  const adaUrl = new URL(`${apiUrl}${adaPath}`);

  function mockGetAdaLovelace(headers: { [key: string]: string } = {}) {
    return nock(apiUrl).get(adaPath).reply(
      200,
      {
        name: 'Ada Lovelace',
      },
      headers,
    );
  }

  function mockGetAlanTuring(headers: { [key: string]: string } = {}) {
    return nock(apiUrl).get(adaPath).reply(
      200,
      {
        name: 'Alan Turing',
      },
      headers,
    );
  }

  function mockInternalServerError(headers: { [key: string]: string } = {}) {
    return nock(apiUrl)
      .get(adaPath)
      .reply(500, 'Internal Server Error', headers);
  }

  it('fetches a response from the origin when not cached', async () => {
    mockGetAdaLovelace();

    const { response, cacheWritePromise } = await httpCache.fetch(adaUrl);
    expect(cacheWritePromise).toBeUndefined();

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it('returns a cached response when not expired', async () => {
    mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

    const { response: firstResponse, cacheWritePromise } =
      await httpCache.fetch(adaUrl);
    expect(firstResponse.url).toBe(adaUrl.toString());

    await cacheWritePromise;
    jest.advanceTimersByTime(10000);

    const { response } = await httpCache.fetch(adaUrl);

    expect(response.url).toBe(adaUrl.toString());
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response.headers.get('age')).toEqual('10');
  });

  it('fetches a fresh response from the origin when expired', async () => {
    mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

    const { cacheWritePromise } = await httpCache.fetch(adaUrl);

    await cacheWritePromise;
    jest.advanceTimersByTime(30000);

    mockGetAlanTuring({ 'cache-control': 'max-age=30' });

    const { response } = await httpCache.fetch(
      new URL('https://api.example.com/people/1'),
    );

    expect(await response.json()).toEqual({ name: 'Alan Turing' });
    expect(response.headers.get('age')).toBeNull();
  });

  describe('overriding TTL', () => {
    it('returns a cached response when the overridden TTL is not expired', async () => {
      mockGetAdaLovelace({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      const { cacheWritePromise } = await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 30,
          },
        },
      );

      await cacheWritePromise;
      jest.advanceTimersByTime(10000);

      const { response } = await httpCache.fetch(adaUrl);

      expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
      expect(response.headers.get('age')).toEqual('10');
    });

    it('fetches a fresh response from the origin when the overridden TTL expired', async () => {
      mockGetAdaLovelace({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      const { cacheWritePromise } = await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 30,
          },
        },
      );

      await cacheWritePromise;
      jest.advanceTimersByTime(30000);

      mockGetAlanTuring({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      const { response } = await httpCache.fetch(
        new URL('https://api.example.com/people/1'),
      );

      expect(await response.json()).toEqual({ name: 'Alan Turing' });
      expect(response.headers.get('age')).toBeNull();
    });

    it('fetches a fresh response from the origin when the overridden TTL expired even if a longer max-age has been specified', async () => {
      mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

      const { cacheWritePromise } = await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 10,
          },
        },
      );

      await cacheWritePromise;
      jest.advanceTimersByTime(10000);

      mockGetAlanTuring({
        'cache-control': 'private, no-cache',
      });

      const { response } = await httpCache.fetch(
        new URL('https://api.example.com/people/1'),
      );

      expect(await response.json()).toEqual({ name: 'Alan Turing' });
      expect(response.headers.get('age')).toBeNull();
    });

    it('does not store a response with an overridden TTL and a non-success status code', async () => {
      mockInternalServerError({ 'cache-control': 'max-age=30' });

      const { cacheWritePromise } = await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 30,
          },
        },
      );

      expect(cacheWritePromise).toBeUndefined();
      expect(store.isEmpty()).toBe(true);
    });

    it('allows overriding the TTL dynamically', async () => {
      mockGetAdaLovelace({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      const { cacheWritePromise } = await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: () => ({
            ttl: 30,
          }),
        },
      );

      await cacheWritePromise;
      jest.advanceTimersByTime(10000);

      const { response } = await httpCache.fetch(adaUrl);

      expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
      expect(response.headers.get('age')).toEqual('10');
    });

    it('allows overriding the TTL dynamically with an async function', async () => {
      mockGetAdaLovelace({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });
      const { cacheWritePromise } = await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: async () => {
            // Make it really async (using nextTick because we're not mocking it)
            await new Promise<void>((resolve) => process.nextTick(resolve));
            return {
              ttl: 30,
            };
          },
        },
      );

      await cacheWritePromise;
      jest.advanceTimersByTime(10000);

      const { response } = await httpCache.fetch(adaUrl);

      expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
      expect(response.headers.get('age')).toEqual('10');
    });

    it('allows disabling caching when the TTL is 0 (falsy)', async () => {
      mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

      const { cacheWritePromise } = await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: () => ({
            ttl: 0,
          }),
        },
      );

      expect(cacheWritePromise).toBeUndefined();
      expect(store.isEmpty()).toBe(true);
    });
  });

  it('allows specifying a custom cache key', async () => {
    nock(apiUrl)
      .get(adaPath)
      .query({ foo: '123' })
      .reply(200, { name: 'Ada Lovelace' }, { 'cache-control': 'max-age=30' });

    const { cacheWritePromise } = await httpCache.fetch(
      new URL(`${adaUrl}?foo=123`),
      {},
      { cacheKey: adaUrl.toString() },
    );

    await cacheWritePromise;
    const { response } = await httpCache.fetch(
      new URL(`${adaUrl}?foo=456`),
      {},
      { cacheKey: adaUrl.toString() },
    );

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it('does not store a response to a non-GET/HEAD request', async () => {
    nock(apiUrl)
      .post(adaPath)
      .reply(200, { name: 'Ada Lovelace' }, { 'cache-control': 'max-age=30' });

    const { cacheWritePromise } = await httpCache.fetch(adaUrl, {
      method: 'POST',
    });

    expect(cacheWritePromise).toBeUndefined();
    expect(store.isEmpty()).toBe(true);
  });

  it('does not store a response with a non-success status code', async () => {
    mockInternalServerError({ 'cache-control': 'max-age=30' });

    const { cacheWritePromise } = await httpCache.fetch(adaUrl);

    expect(cacheWritePromise).toBeUndefined();
    expect(store.isEmpty()).toBe(true);
  });

  it('does not store a response without cache-control header', async () => {
    mockGetAdaLovelace();

    const { cacheWritePromise } = await httpCache.fetch(adaUrl);

    expect(cacheWritePromise).toBeUndefined();
    expect(store.isEmpty()).toBe(true);
  });

  it('does not store a private response', async () => {
    mockGetAdaLovelace({ 'cache-control': 'private, max-age: 60' });

    const { cacheWritePromise } = await httpCache.fetch(adaUrl);

    expect(cacheWritePromise).toBeUndefined();
    expect(store.isEmpty()).toBe(true);
  });

  it('returns a cached response when vary header fields match', async () => {
    mockGetAdaLovelace({
      'cache-control': 'max-age=30',
      vary: 'Accept-Language',
    });

    const { cacheWritePromise } = await httpCache.fetch(adaUrl, {
      headers: { 'accept-language': 'en' },
    });
    await cacheWritePromise;

    const { response } = await httpCache.fetch(adaUrl, {
      headers: { 'accept-language': 'en' },
    });

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it(`does not return a cached response when vary header fields don't match`, async () => {
    mockGetAdaLovelace({
      'cache-control': 'max-age=30',
      vary: 'Accept-Language',
    });

    const { cacheWritePromise } = await httpCache.fetch(adaUrl, {
      headers: { 'accept-language': 'en' },
    });
    await cacheWritePromise;

    mockGetAlanTuring({ 'cache-control': 'max-age=30' });

    const { response } = await httpCache.fetch(
      new URL('https://api.example.com/people/1'),
      {
        headers: { 'accept-language': 'fr' },
      },
    );

    expect(await response.json()).toEqual({ name: 'Alan Turing' });
  });

  it('sets the TTL as max-age when the response does not contain revalidation headers', async () => {
    mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

    const storeSet = jest.spyOn(store, 'set');

    const { cacheWritePromise } = await httpCache.fetch(adaUrl);
    await cacheWritePromise;

    expect(storeSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { ttl: 30 },
    );
    storeSet.mockRestore();
  });

  it('sets the TTL as 2 * max-age when the response contains an ETag header', async () => {
    mockGetAdaLovelace({ 'cache-control': 'max-age=30', etag: 'foo' });

    const storeSet = jest.spyOn(store, 'set');

    const { cacheWritePromise } = await httpCache.fetch(adaUrl);
    await cacheWritePromise;

    expect(storeSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { ttl: 60 },
    );

    storeSet.mockRestore();
  });

  it('revalidates a cached response when expired and returns the cached response when not modified via etag', async () => {
    mockGetAdaLovelace({
      'cache-control': 'public, max-age=30',
      etag: 'foo',
    });

    const { response: response0, cacheWritePromise: cwp1 } =
      await httpCache.fetch(adaUrl);
    expect(response0.status).toEqual(200);
    expect(await response0.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response0.headers.get('age')).toBeNull();

    await cwp1;
    jest.advanceTimersByTime(10000);

    const { response: response1, cacheWritePromise: cwp2 } =
      await httpCache.fetch(adaUrl);
    expect(cwp2).toBeUndefined();
    expect(response1.status).toEqual(200);
    expect(await response1.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response1.headers.get('age')).toEqual('10');

    jest.advanceTimersByTime(21000);

    nock(apiUrl)
      .get(adaPath)
      .matchHeader('if-none-match', 'foo')
      .reply(304, undefined, {
        'cache-control': 'public, max-age=30',
        etag: 'foo',
      });

    const { response, cacheWritePromise: cwp3 } = await httpCache.fetch(adaUrl);
    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response.headers.get('age')).toEqual('0');

    await cwp3;
    jest.advanceTimersByTime(10000);

    const { response: response2, cacheWritePromise: cwp4 } =
      await httpCache.fetch(adaUrl);

    expect(cwp4).toBeUndefined();
    expect(response2.status).toEqual(200);
    expect(await response2.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response2.headers.get('age')).toEqual('10');
  });

  it('revalidates a cached response when expired and returns the cached response when not modified via last-modified', async () => {
    mockGetAdaLovelace({
      'cache-control': 'public, max-age=30',
      'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
    });

    const { response: response0, cacheWritePromise: cwp1 } =
      await httpCache.fetch(adaUrl);
    expect(response0.status).toEqual(200);
    expect(await response0.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response0.headers.get('age')).toBeNull();

    await cwp1;
    jest.advanceTimersByTime(10000);

    const { response: response1, cacheWritePromise: cwp2 } =
      await httpCache.fetch(adaUrl);
    expect(cwp2).toBeUndefined();
    expect(response1.status).toEqual(200);
    expect(await response1.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response1.headers.get('age')).toEqual('10');

    jest.advanceTimersByTime(21000);

    nock(apiUrl)
      .get(adaPath)
      .matchHeader('if-modified-since', 'Wed, 21 Oct 2015 07:28:00 GMT')
      .reply(304, undefined, {
        'cache-control': 'public, max-age=30',
        'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
      });

    const { response, cacheWritePromise: cwp3 } = await httpCache.fetch(adaUrl);

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response.headers.get('age')).toEqual('0');

    await cwp3;
    jest.advanceTimersByTime(10000);

    const { response: response2, cacheWritePromise: cwp4 } =
      await httpCache.fetch(adaUrl);

    expect(cwp4).toBeUndefined();
    expect(response2.status).toEqual(200);
    expect(await response2.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response2.headers.get('age')).toEqual('10');
  });

  it('revalidates a cached response when expired and returns and caches a fresh response when modified', async () => {
    mockGetAdaLovelace({
      'cache-control': 'public, max-age=30',
      etag: 'foo',
    });

    {
      const { cacheWritePromise } = await httpCache.fetch(adaUrl);
      await cacheWritePromise;
    }

    jest.advanceTimersByTime(30000);

    mockGetAlanTuring({
      'cache-control': 'public, max-age=30',
      etag: 'bar',
    });

    {
      const { response, cacheWritePromise } = await httpCache.fetch(
        new URL('https://api.example.com/people/1'),
      );

      expect(cacheWritePromise).toBeDefined();
      expect(response.status).toEqual(200);
      expect(await response.json()).toEqual({ name: 'Alan Turing' });

      await cacheWritePromise;
    }

    jest.advanceTimersByTime(10000);

    {
      const { response: response2, cacheWritePromise } = await httpCache.fetch(
        new URL('https://api.example.com/people/1'),
      );

      expect(cacheWritePromise).toBeUndefined();
      expect(response2.status).toEqual(200);
      expect(await response2.json()).toEqual({ name: 'Alan Turing' });
      expect(response2.headers.get('age')).toEqual('10');
    }
  });

  it('fetches a response from the origin with a custom fetch function', async () => {
    mockGetAdaLovelace();

    const customFetch = jest.fn(fetch);
    const customHttpCache = new HTTPCache(store, customFetch);

    const { response, cacheWritePromise } = await customHttpCache.fetch(adaUrl);

    expect(cacheWritePromise).toBeUndefined();
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  describe('HEAD requests', () => {
    it('bypasses the cache', async () => {
      // x2
      nock(apiUrl).head(adaPath).times(2).reply(200);

      for (const _ of [1, 2]) {
        const { cacheWritePromise } = await httpCache.fetch(adaUrl, {
          method: 'HEAD',
        });
        expect(cacheWritePromise).toBeUndefined();
      }
    });

    it('bypasses the cache even with explicit ttl', async () => {
      // x2
      nock(apiUrl).head(adaPath).times(2).reply(200);

      {
        const { cacheWritePromise } = await httpCache.fetch(
          adaUrl,
          {
            method: 'HEAD',
          },
          { cacheOptions: { ttl: 30000 } },
        );
        expect(cacheWritePromise).toBeUndefined();
      }

      {
        const { cacheWritePromise } = await httpCache.fetch(adaUrl, {
          method: 'HEAD',
        });
        expect(cacheWritePromise).toBeUndefined();
      }
    });
  });
});
