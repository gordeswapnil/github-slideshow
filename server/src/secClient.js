const config = require('./config');
const { createCache } = require('./cache');

// Spaces request *starts* by at least 1000/maxRequestsPerSecond ms so we never
// exceed SEC's fair-access ceiling. The timing chain only gates request starts;
// it does not wait for a request to finish, so independent requests can overlap.
function createRateLimiter({ maxRequestsPerSecond, sleepImpl, now }) {
  const minIntervalMs = 1000 / maxRequestsPerSecond;
  let gate = Promise.resolve();
  // So the very first request is not delayed.
  let lastStart = Number.NEGATIVE_INFINITY;
  return function run(task) {
    const ready = gate.then(async () => {
      const wait = Math.max(0, lastStart + minIntervalMs - now());
      if (wait > 0) await sleepImpl(wait);
      lastStart = now();
    });
    // Next caller waits only for this gate, not for `task` to resolve.
    gate = ready.then(
      () => undefined,
      () => undefined
    );
    return ready.then(() => task());
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createSecClient(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    sleepImpl = defaultSleep,
    now = () => Date.now(),
    cache = createCache(config.cacheTtlMs),
    userAgent = config.userAgent,
    acceptEncoding = config.acceptEncoding,
    maxRetries = config.maxRetries,
    baseBackoffMs = config.baseBackoffMs,
    maxRequestsPerSecond = config.maxRequestsPerSecond,
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available. Use Node 18+ or inject fetchImpl.');
  }

  const limiter = createRateLimiter({ maxRequestsPerSecond, sleepImpl, now });

  const headers = {
    'User-Agent': userAgent,
    'Accept-Encoding': acceptEncoding,
    Accept: 'application/json',
  };

  function backoffDelay(attempt, response) {
    const retryAfter = Number(response && response.headers && response.headers.get
      ? response.headers.get('retry-after')
      : NaN);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }
    return baseBackoffMs * 2 ** attempt;
  }

  async function request(url, parse, cacheKey) {
    const key = cacheKey || url;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let attempt = 0;
    // Retry on 429 and 5xx (and network errors), with exponential backoff.
    while (true) {
      let response;
      try {
        response = await limiter(() => fetchImpl(url, { headers }));
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        await sleepImpl(baseBackoffMs * 2 ** attempt);
        attempt += 1;
        continue;
      }

      if (response.ok) {
        const data = await parse(response);
        cache.set(key, data);
        return data;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleepImpl(backoffDelay(attempt, response));
        attempt += 1;
        continue;
      }

      const err = new Error(
        `Request failed: ${response.status} ${response.statusText || ''} for ${url}`.trim()
      );
      err.status = response.status;
      throw err;
    }
  }

  const getJson = (url) => request(url, (r) => r.json());
  const getText = (url) => request(url, (r) => r.text(), `text:${url}`);

  return { getJson, getText, cache, headers };
}

module.exports = { createSecClient, createRateLimiter };
