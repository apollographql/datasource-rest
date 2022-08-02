import fetch from 'node-fetch';
import nock from 'nock';
import { HTTPCache } from '../HTTPCache';
import { MapKeyValueCache } from './MapKeyValueCache';
import { nockAfterEach, nockBeforeEach } from './nockAssertions';

describe('HTTPCache', () => {
  let store: MapKeyValueCache<string>;
  let httpCache: HTTPCache;

  beforeEach(() => {
    nockBeforeEach();
    store = new MapKeyValueCache<string>();
    httpCache = new HTTPCache(store, fetch);
  });

  afterEach(nockAfterEach);

  beforeAll(() => {
    // nock depends on process.nextTick
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const apiUrl = 'https://api.example.com';
  const adaPath = '/people/1';
  const adaUrl = `${apiUrl}${adaPath}`;
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

    const response = await httpCache.fetch(adaUrl);

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it('returns a cached response when not expired', async () => {
    mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

    await httpCache.fetch(adaUrl);

    jest.advanceTimersByTime(10000);

    const response = await httpCache.fetch(adaUrl);

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response.headers.get('age')).toEqual('10');
  });

  it('fetches a fresh response from the origin when expired', async () => {
    mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

    await httpCache.fetch(adaUrl);

    jest.advanceTimersByTime(30000);

    mockGetAlanTuring({ 'cache-control': 'max-age=30' });

    const response = await httpCache.fetch('https://api.example.com/people/1');

    expect(await response.json()).toEqual({ name: 'Alan Turing' });
    expect(response.headers.get('age')).toEqual('0');
  });

  describe('overriding TTL', () => {
    it('returns a cached response when the overridden TTL is not expired', async () => {
      mockGetAdaLovelace({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 30,
          },
        },
      );

      jest.advanceTimersByTime(10000);

      const response = await httpCache.fetch(adaUrl);

      expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
      expect(response.headers.get('age')).toEqual('10');
    });

    it('fetches a fresh response from the origin when the overridden TTL expired', async () => {
      mockGetAdaLovelace({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 30,
          },
        },
      );

      jest.advanceTimersByTime(30000);

      mockGetAlanTuring({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      const response = await httpCache.fetch(
        'https://api.example.com/people/1',
      );

      expect(await response.json()).toEqual({ name: 'Alan Turing' });
      expect(response.headers.get('age')).toEqual('0');
    });

    it('fetches a fresh response from the origin when the overridden TTL expired even if a longer max-age has been specified', async () => {
      mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

      await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 10,
          },
        },
      );

      jest.advanceTimersByTime(10000);

      mockGetAlanTuring({
        'cache-control': 'private, no-cache',
      });

      const response = await httpCache.fetch(
        'https://api.example.com/people/1',
      );

      expect(await response.json()).toEqual({ name: 'Alan Turing' });
      expect(response.headers.get('age')).toEqual('0');
    });

    it('does not store a response with an overridden TTL and a non-success status code', async () => {
      mockInternalServerError({ 'cache-control': 'max-age=30' });

      await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: {
            ttl: 30,
          },
        },
      );

      expect(store.size).toEqual(0);
    });

    it('allows overriding the TTL dynamically', async () => {
      mockGetAdaLovelace({
        'cache-control': 'private, no-cache',
        'set-cookie': 'foo',
      });

      await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: () => ({
            ttl: 30,
          }),
        },
      );

      jest.advanceTimersByTime(10000);

      const response = await httpCache.fetch(adaUrl);

      expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
      expect(response.headers.get('age')).toEqual('10');
    });

    it('allows disabling caching when the TTL is 0 (falsy)', async () => {
      mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

      await httpCache.fetch(
        adaUrl,
        {},
        {
          cacheOptions: () => ({
            ttl: 0,
          }),
        },
      );

      expect(store.size).toEqual(0);
    });
  });

  it('allows specifying a custom cache key', async () => {
    nock(apiUrl)
      .get(adaPath)
      .query({ foo: '123' })
      .reply(200, { name: 'Ada Lovelace' }, { 'cache-control': 'max-age=30' });

    await httpCache.fetch(`${adaUrl}?foo=123`, {}, { cacheKey: adaUrl });

    const response = await httpCache.fetch(
      `${adaUrl}?foo=456`,
      {},
      { cacheKey: adaUrl },
    );

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it('does not store a response to a non-GET request', async () => {
    nock(apiUrl)
      .post(adaPath)
      .reply(200, { name: 'Ada Lovelace' }, { 'cache-control': 'max-age=30' });

    await httpCache.fetch(adaUrl, { method: 'POST' });

    expect(store.size).toEqual(0);
  });

  it('does not store a response with a non-success status code', async () => {
    mockInternalServerError({ 'cache-control': 'max-age=30' });

    await httpCache.fetch(adaUrl);

    expect(store.size).toEqual(0);
  });

  it('does not store a response without cache-control header', async () => {
    mockGetAdaLovelace();

    await httpCache.fetch(adaUrl);

    expect(store.size).toEqual(0);
  });

  it('does not store a private response', async () => {
    mockGetAdaLovelace({ 'cache-control': 'private, max-age: 60' });

    await httpCache.fetch(adaUrl);

    expect(store.size).toEqual(0);
  });

  it('returns a cached response when vary header fields match', async () => {
    mockGetAdaLovelace({
      'cache-control': 'max-age=30',
      vary: 'Accept-Language',
    });

    await httpCache.fetch(adaUrl, {
      headers: { 'accept-language': 'en' },
    });

    const response = await httpCache.fetch(adaUrl, {
      headers: { 'accept-language': 'en' },
    });

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });

  it(`does not return a cached response when vary header fields don't match`, async () => {
    mockGetAdaLovelace({
      'cache-control': 'max-age=30',
      vary: 'Accept-Language',
    });

    await httpCache.fetch(adaUrl, {
      headers: { 'accept-language': 'en' },
    });

    mockGetAlanTuring({ 'cache-control': 'max-age=30' });

    const response = await httpCache.fetch('https://api.example.com/people/1', {
      headers: { 'accept-language': 'fr' },
    });

    expect(await response.json()).toEqual({ name: 'Alan Turing' });
  });

  it('sets the TTL as max-age when the response does not contain revalidation headers', async () => {
    mockGetAdaLovelace({ 'cache-control': 'max-age=30' });

    const storeSet = jest.spyOn(store, 'set');

    await httpCache.fetch(adaUrl);

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

    await httpCache.fetch(adaUrl);

    expect(storeSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { ttl: 60 },
    );

    storeSet.mockRestore();
  });

  it('revalidates a cached response when expired and returns the cached response when not modified', async () => {
    mockGetAdaLovelace({
      'cache-control': 'public, max-age=30',
      etag: 'foo',
    });

    await httpCache.fetch(adaUrl);

    jest.advanceTimersByTime(30000);

    nock(apiUrl)
      .get(adaPath)
      .matchHeader('if-none-match', 'foo')
      .reply(304, undefined, {
        'cache-control': 'public, max-age=30',
        etag: 'foo',
      });

    const response = await httpCache.fetch(adaUrl);

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response.headers.get('age')).toEqual('0');

    jest.advanceTimersByTime(10000);

    const response2 = await httpCache.fetch(adaUrl);

    expect(response2.status).toEqual(200);
    expect(await response2.json()).toEqual({ name: 'Ada Lovelace' });
    expect(response2.headers.get('age')).toEqual('10');
  });

  it('revalidates a cached response when expired and returns and caches a fresh response when modified', async () => {
    mockGetAdaLovelace({
      'cache-control': 'public, max-age=30',
      etag: 'foo',
    });

    await httpCache.fetch(adaUrl);

    jest.advanceTimersByTime(30000);

    mockGetAlanTuring({
      'cache-control': 'public, max-age=30',
      etag: 'bar',
    });

    const response = await httpCache.fetch('https://api.example.com/people/1');

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({ name: 'Alan Turing' });

    jest.advanceTimersByTime(10000);

    const response2 = await httpCache.fetch('https://api.example.com/people/1');

    expect(response2.status).toEqual(200);
    expect(await response2.json()).toEqual({ name: 'Alan Turing' });
    expect(response2.headers.get('age')).toEqual('10');
  });

  it('fetches a response from the origin with a custom fetch function', async () => {
    mockGetAdaLovelace();

    const customFetch = jest.fn(fetch);
    const customHttpCache = new HTTPCache(store as any, customFetch);

    const response = await customHttpCache.fetch(adaUrl);

    expect(await response.json()).toEqual({ name: 'Ada Lovelace' });
  });
});
