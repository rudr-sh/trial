// Usage: node loadtest.mjs <baseUrl> <users> <arrivalWindowMs> [teams] [spike]
//
// Examples:
//   node loadtest.mjs https://trial-psi-jet.vercel.app 300 60000 150
//   node loadtest.mjs https://trial-psi-jet.vercel.app 300 10000 150 spike
//   node loadtest.mjs https://trial-psi-jet.vercel.app 300 3000 150
//
// Simulates USERS people arriving at random moments inside the arrival window.
// Each user belongs to team "Test<n>" (n = 1..TEAMS), so ~2 users share a team at 300 users / 150 teams.
// Flow per user: GET /api/problems -> (think time) -> POST /api/claim, retry if the problem was taken.
//
// "spike" mode front-loads arrivals (like a real announcement): about half the users
// arrive in the first ~12% of the window.
//
// RESET the database before every run:
//   update teams set problem_id = null;
//   update problems set claimed_by = null;

const BASE = (process.argv[2] || 'https://trial-psi-jet.vercel.app').replace(/\/$/, '');
const USERS = parseInt(process.argv[3]) || 300;
const WINDOW_MS = parseInt(process.argv[4]) || 60000;
const TEAMS = parseInt(process.argv[5]) || 150;
const SPIKE = process.argv[6] === 'spike' || !!process.env.SPIKE;

const THINK_MIN_MS = 500;    // time a human takes to pick from the dropdown
const THINK_MAX_MS = 2500;
const MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 30000;

const stats = {
  ok: 0, already: 0, takenRetries: 0, noProblems: 0, errors: 0, requests: 0,
};
const statusCount = {};
const latGet = [];
const latPost = [];
const errorSamples = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

async function call(kind, url, opts = {}) {
  const t = performance.now();
  stats.requests++;
  const bucket = kind === 'get' ? latGet : latPost;
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const d = await r.json().catch(() => ({}));
    bucket.push(performance.now() - t);
    statusCount[r.status] = (statusCount[r.status] || 0) + 1;
    return { status: r.status, d };
  } catch (e) {
    bucket.push(performance.now() - t);
    const key = e && e.name === 'TimeoutError' ? 'timeout' : 'network';
    statusCount[key] = (statusCount[key] || 0) + 1;
    return { status: 0, d: { error: String(e && e.message ? e.message : e) } };
  }
}

function fail(msg) {
  stats.errors++;
  if (errorSamples.length < 5) errorSamples.push(msg);
}

async function user(i) {
  const skew = SPIKE ? Math.pow(Math.random(), 3) : Math.random();
  await sleep(skew * WINDOW_MS); // arrival time
  const team = 'Test' + (1 + (i % TEAMS));

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const g = await call('get', `${BASE}/api/problems?team=${encodeURIComponent(team)}`);
    if (g.status !== 200) return fail(`GET ${team} -> ${g.status} ${JSON.stringify(g.d).slice(0, 120)}`);
    if (g.d.claimed) { stats.already++; return; }

    const list = g.d.problems || [];
    if (!list.length) { stats.noProblems++; return; }

    await sleep(rand(THINK_MIN_MS, THINK_MAX_MS));
    const pick = list[Math.floor(Math.random() * list.length)];

    const c = await call('post', `${BASE}/api/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, problemId: pick.id }),
    });

    if (c.status === 200) { stats.ok++; return; }
    if (c.status === 409 && /already/i.test(c.d.error || '')) { stats.already++; return; }
    if (c.status === 409) { stats.takenRetries++; continue; } // lost the race, try again
    return fail(`POST ${team} -> ${c.status} ${JSON.stringify(c.d).slice(0, 120)}`);
  }
  fail(`${team}: gave up after ${MAX_ATTEMPTS} attempts`);
}

const pct = (arr, p) => (arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]) : 0);
const summary = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return `median ${pct(s, 0.5)} | p95 ${pct(s, 0.95)} | max ${pct(s, 1)}`;
};

console.log(`Target: ${BASE}`);
console.log(`Users: ${USERS} | arrival window: ${WINDOW_MS} ms | teams: ${TEAMS} | spike: ${SPIKE}\n`);

const start = performance.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
const secs = ((performance.now() - start) / 1000).toFixed(1);

const all = [...latGet, ...latPost].sort((a, b) => a - b);
const median = pct(all, 0.5);
const p95 = pct(all, 0.95);
const expectedClaims = Math.min(TEAMS, USERS);

console.log('--- RESULT ---');
console.log('Total time:', secs, 's | requests:', stats.requests);
console.log(`Claims succeeded (should be ${expectedClaims}):`, stats.ok);
console.log('Teammates told "already chosen":', stats.already);
console.log('Lost a race and retried:', stats.takenRetries);
console.log('Teams with no problems left:', stats.noProblems);
console.log('ERRORS (should be 0):', stats.errors);
console.log('HTTP status counts:', JSON.stringify(statusCount));
console.log(`Latency ms (all)  -> median ${median}, p95 ${p95}, max ${pct(all, 1)}`);
console.log(`Latency ms (GET)  -> ${summary(latGet)}`);
console.log(`Latency ms (POST) -> ${summary(latPost)}`);
if (errorSamples.length) {
  console.log('\nError samples:');
  errorSamples.forEach((e) => console.log(' -', e));
}

const pass = stats.errors === 0 && stats.ok === expectedClaims && median < 1000 && p95 < 3000;
console.log(
  '\nVERDICT:',
  pass ? 'PASS' : 'FAIL',
  `(errors=0: ${stats.errors === 0}, claims=${expectedClaims}: ${stats.ok === expectedClaims}, median<1s: ${median < 1000}, p95<3s: ${p95 < 3000})`
);
console.log('\nNow verify in Supabase (both counts should equal ' + expectedClaims + ', third query returns no rows):');
console.log('  select count(*) from teams where problem_id is not null;');
console.log('  select count(*) from problems where claimed_by is not null;');
console.log('  select problem_id, count(*) from teams where problem_id is not null group by problem_id having count(*) > 1;');
process.exit(pass ? 0 : 1);