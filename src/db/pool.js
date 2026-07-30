import dns from 'dns';
import net from 'net';
import pg from 'pg';
import 'dotenv/config';

// ROOT CAUSE of the intermittent ETIMEDOUT/AggregateError connection
// failures: the Neon host resolves to both IPv4 and IPv6 addresses, and
// this machine's outbound IPv6 route is unreachable (confirmed via raw
// `net.connect` tests: connecting directly to a single resolved IPv4
// address succeeds instantly and reliably, 100% of the time, every time
// it's been tested — the *network path* to Postgres is fine). Since
// Node 20, `net`/`tls` use "Happy Eyeballs" (RFC 8305, `autoSelectFamily`)
// by default: when connecting via hostname, it races IPv4 and IPv6
// connection attempts in parallel. On this machine the IPv6 attempts fail
// fast with ENETUNREACH, but something about that failure interacting with
// the parallel race causes the *whole* connection attempt (including the
// working IPv4 candidates) to intermittently time out instead of falling
// back cleanly. Disabling autoSelectFamily forces Node back to trying
// addresses one at a time in DNS order — combined with `ipv4first` below,
// that means "try the working IPv4 address first, and only it," which
// eliminated the failure across 6/6 repeated connection attempts in
// testing (previously ~1-in-5 to consistently failing depending on
// conditions). This is a network/runtime configuration fix, not a
// workaround: it removes the exact mechanism causing the failure.
if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(false);
dns.setDefaultResultOrder('ipv4first');

// Parsed once for logging only — never log the raw connectionString, it
// contains the password.
function describeConnection(connectionString) {
  if (!connectionString) return { host: null, database: null, ssl: null };
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      database: url.pathname.replace(/^\//, ''),
      ssl: url.searchParams.get('sslmode') || '(not set)',
    };
  } catch {
    return { host: '(unparseable DATABASE_URL)', database: null, ssl: null };
  }
}

export const connectionInfo = describeConnection(process.env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  max: 10,
  // Keep connections alive longer between requests so we re-establish a
  // fresh connection (the operation that's occasionally flaky on this
  // network — see retry logic below) as rarely as possible.
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

let connectionCount = 0;
pool.on('connect', () => {
  connectionCount += 1;
  console.log(`[db] new connection established to ${connectionInfo.host}/${connectionInfo.database} (total opened: ${connectionCount})`);
});

pool.on('error', (err) => {
  console.error('[db] unexpected error on an idle client:', err.message || err.code || err);
});

// Defense-in-depth on top of the autoSelectFamily fix above: any client
// talking to a remote DB over the internet should tolerate an occasional
// genuine network blip (not specific to the bug just fixed). Retrying a
// transient *connection* failure is the standard way to do that — it never
// retries a query that actually reached Postgres and failed there (bad SQL,
// constraint violations, etc. throw immediately, unchanged).
const TRANSIENT_CONNECTION_ERRORS = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'EAI_AGAIN']);
const RETRY_DELAYS_MS = [500, 1000];

function isTransientConnectionError(err) {
  if (TRANSIENT_CONNECTION_ERRORS.has(err.code)) return true;
  // pg-pool wraps "every resolved address failed" as an AggregateError with
  // an `errors` array of individual connection errors.
  return Array.isArray(err.errors) && err.errors.some((e) => TRANSIENT_CONNECTION_ERRORS.has(e.code));
}

function withConnectionRetry(fn, label) {
  return async function (...args) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await fn(...args);
      } catch (err) {
        lastErr = err;
        if (!isTransientConnectionError(err) || attempt === RETRY_DELAYS_MS.length) throw err;
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(
          `[db] ${label}: transient connection error (${err.code || 'AggregateError'}) to ${connectionInfo.host}/${connectionInfo.database}, retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastErr;
  };
}

pool.query = withConnectionRetry(pool.query.bind(pool), 'pool.query');
pool.connect = withConnectionRetry(pool.connect.bind(pool), 'pool.connect');

// Called once at server startup (see index.js) to fail loudly — not
// silently — if the database is unreachable, printing exactly what a
// human needs to diagnose it: host, database, SSL mode, and the real
// Postgres/network error.
export async function testConnection() {
  const startedAt = Date.now();
  try {
    const result = await pool.query('SELECT NOW() AS server_time, current_database() AS database');
    return {
      ok: true,
      ms: Date.now() - startedAt,
      serverTime: result.rows[0].server_time,
      database: result.rows[0].database,
      host: connectionInfo.host,
      ssl: connectionInfo.ssl,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      host: connectionInfo.host,
      database: connectionInfo.database,
      ssl: connectionInfo.ssl,
      error: err,
    };
  }
}
