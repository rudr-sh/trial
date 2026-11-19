const BASE = process.argv[2] || 'https://trial-psi-jet.vercel.app';
const TEAMS = 180, USERS = 750, JITTER_MS = 3000;

const stats = { ok: 0, already: 0, takenRetries: 0, noProblems: 0, errors: 0, requests: 0 };
const lat = [];

async function call(url, opts) {
  const t = performance.now();
  stats.requests++;
  try {
    const r = await fetch(url, opts);
    const d = await r.json().catch(() => ({}));
    lat.push(performance.now() - t);
    return { status: r.status, d };
  } catch {
    stats.errors++;
    return { status: 0, d: {} };
  }
}

async function user(i) {
  await new Promise((r) => setTimeout(r, Math.random() * JITTER_MS));
  const team = 'Test' + (1 + (i % TEAMS));
  for (let attempt = 0; attempt < 8; attempt++) {
    const g = await call(`${BASE}/api/problems?team=${encodeURIComponent(team)}`);
    if (g.status !== 200) { stats.errors++; return; }
    if (g.d.claimed) { stats.already++; return; }
    const list = g.d.problems || [];
    if (!list.length) { stats.noProblems++; return; }
    const pick = list[Math.floor(Math.random() * list.length)];
    const c = await call(`${BASE}/api/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, problemId: pick.id }),
    });
    if (c.status === 200) { stats.ok++; return; }
    if (c.status === 409 && /already/i.test(c.d.error || '')) { stats.already++; return; }
    if (c.status === 409) { stats.takenRetries++; continue; }
    stats.errors++;
    return;
  }
}

const start = performance.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
const secs = ((performance.now() - start) / 1000).toFixed(1);

lat.sort((a, b) => a - b);
const pct = (p) => Math.round(lat[Math.floor(lat.length * p)] || 0);
console.log('\n--- RESULT ---');
console.log('Total time:', secs, 's | requests:', stats.requests);
console.log('Claims succeeded (should be ~180):', stats.ok);
console.log('Teammates told "already chosen":', stats.already);
console.log('Lost a race and retried:', stats.takenRetries);
console.log('Teams with no problems left:', stats.noProblems);
console.log('ERRORS (should be 0):', stats.errors);
console.log(`Latency ms -> median ${pct(0.5)}, p95 ${pct(0.95)}, max ${Math.round(lat[lat.length - 1] || 0)}`);