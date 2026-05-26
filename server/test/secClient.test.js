const { createSecClient, createRateLimiter } = require('../src/secClient');
const { createCache } = require('../src/cache');

// A fetch-like response stub.
function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function makeClient(fetchImpl, overrides = {}) {
  const sleeps = [];
  // An always-advancing clock so the rate limiter never needs to sleep; this
  // keeps `sleeps` limited to retry/backoff delays only.
  let clock = 0;
  const client = createSecClient({
    fetchImpl,
    sleepImpl: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => {
      clock += 1e6;
      return clock;
    },
    cache: createCache(60000),
    maxRetries: 4,
    baseBackoffMs: 100,
    maxRequestsPerSecond: 1000,
    ...overrides,
  });
  return { client, sleeps };
}

describe('createSecClient headers', () => {
  test('sets SEC-compliant User-Agent and Accept-Encoding', () => {
    const { client } = makeClient(async () => res(200, {}));
    expect(client.headers['User-Agent']).toMatch(/@/);
    expect(client.headers['Accept-Encoding']).toBe('gzip, deflate');
  });
});

describe('getJson caching', () => {
  test('only fetches once for the same URL', async () => {
    const fetchImpl = jest.fn(async () => res(200, { hello: 'world' }));
    const { client } = makeClient(fetchImpl);
    const a = await client.getJson('https://example.com/x.json');
    const b = await client.getJson('https://example.com/x.json');
    expect(a).toEqual({ hello: 'world' });
    expect(b).toEqual({ hello: 'world' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('getJson retry/backoff', () => {
  test('retries on 429 then succeeds, honoring Retry-After', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(res(429, null, { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const { client, sleeps } = makeClient(fetchImpl);
    const data = await client.getJson('https://example.com/a.json');
    expect(data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(2000); // Retry-After: 2 seconds
  });

  test('retries on 5xx then succeeds with exponential backoff', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const { client, sleeps } = makeClient(fetchImpl);
    const data = await client.getJson('https://example.com/b.json');
    expect(data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]); // baseBackoff * 2^attempt
  });

  test('retries on network errors', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const { client } = makeClient(fetchImpl);
    await expect(client.getJson('https://example.com/c.json')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does not retry on non-retryable 404', async () => {
    const fetchImpl = jest.fn(async () => res(404));
    const { client } = makeClient(fetchImpl);
    await expect(client.getJson('https://example.com/d.json')).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('gives up after exhausting retries', async () => {
    const fetchImpl = jest.fn(async () => res(429));
    const { client } = makeClient(fetchImpl, { maxRetries: 2 });
    await expect(client.getJson('https://example.com/e.json')).rejects.toMatchObject({
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe('createRateLimiter', () => {
  test('spaces request starts by the minimum interval', async () => {
    let clock = 0;
    const sleeps = [];
    const limiter = createRateLimiter({
      maxRequestsPerSecond: 10, // 100ms minimum interval
      now: () => clock,
      sleepImpl: (ms) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });
    await limiter(() => Promise.resolve());
    await limiter(() => Promise.resolve());
    await limiter(() => Promise.resolve());
    // First runs immediately; the next two each wait one 100ms interval.
    expect(sleeps).toEqual([100, 100]);
  });
});
