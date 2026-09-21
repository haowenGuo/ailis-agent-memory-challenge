// Original synthetic operational load only. Never use private benchmark material here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = (process.env.AML_PUBLIC_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const key = process.env.AML_MEMORY_KEY;
if (!key) throw new Error('AML_MEMORY_KEY required');
const scope = `operator-capacity-${randomUUID()}`;
const count = Number(process.env.AML_PROBE_MESSAGES || 10000);
const searchCount = Number(process.env.AML_PROBE_SEARCHES || 20);
const tokens = Array.from({ length: count }, () => 'sentinel' + randomUUID().replaceAll('-', ''));
const lengths = []; const addTimes = []; const searchTimes = [];
const post = async (endpoint, body, times) => {
  const start = performance.now();
  const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const data = await response.json();
  assert.equal(response.status, 200, `probe ${endpoint} failed: HTTP ${response.status}`);
  times?.push(performance.now() - start);
  return data;
};
for (let offset = 0; offset < count; offset += 1000) {
  const messages = tokens.slice(offset, offset + 1000).map(token => ({ role: 'user', content: `${token}: Original synthetic storage and retrieval evidence. ` + 'Padding verifies intact memory representation. '.repeat(12) }));
  for (const m of messages) lengths.push(Buffer.byteLength(m.content));
  await post('/add', { user_id: scope, request_id: `batch-${offset}`, session_id: `session-${offset}`, messages }, addTimes);
}
for (let i = 0; i < searchCount; i++) {
  const token = tokens[Math.floor(i * (count - 1) / Math.max(1, searchCount - 1))];
  const data = await post('/search', { user_id: scope, query: token, top_k: 100 }, searchTimes);
  assert.ok(data.data.some(row => row.content.includes(token)), 'synthetic source evidence missing');
}
for (let i = 0; i < 12; i++) await post('/add', { user_id: `${scope}-eviction-${i}`, request_id: 'write', session_id: 'session', messages: [{ role: 'user', content: `synthetic cache churn ${i}` }] });
const afterEviction = await post('/search', { user_id: scope, query: tokens[0], top_k: 100 }, searchTimes);
assert.ok(afterEviction.data.some(row => row.content.includes(tokens[0])));
const stats = list => { const sorted = [...list].sort((a,b) => a-b); return { count: list.length, mean_ms: list.reduce((a,b)=>a+b,0)/list.length, p95_ms: sorted[Math.ceil(sorted.length*.95)-1], max_ms: sorted.at(-1) }; };
console.log(JSON.stringify({ scope, messages: count, content_bytes: lengths.reduce((a,b)=>a+b,0), add: stats(addTimes), search: stats(searchTimes), cache_eviction_recovery: true, generator: 'original-synthetic', generation_model_calls: 0 }));
