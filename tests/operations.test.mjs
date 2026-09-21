import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { MemoryService } from '../src/memory.mjs';
import { createServer } from '../src/server.mjs';

test('cache eviction preserves complete evidence, write idempotency and source isolation', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aml-cache-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const service = new MemoryService({ rootDir, maxCachedScopes: 1, maxCachedBytes: 2048 });
  const body = user => ({ user_id: user, session_id: 'session', request_id: 'write', messages: [{ role: 'user', content: `${user} cobalt sentinel ` + 'padding '.repeat(400) }] });
  for (const user of ['first', 'second', 'third']) service.add('unified', body(user));
  assert.equal(service.scopes.size, 0); // each individual scope exceeds the byte budget
  for (const user of ['first', 'second', 'third']) {
    service.add('unified', body(user));
    const result = service.search('unified', { user_id: user, query: 'cobalt', top_k: 100 });
    assert.equal(result.data.length, 1);
    assert.ok(result.data[0].content.endsWith(body(user).messages[0].content));
  }
  const restarted = new MemoryService({ rootDir, maxCachedScopes: 1 });
  const expected = service.search('unified', { user_id: 'first', query: 'cobalt', top_k: 100 });
  assert.deepEqual(restarted.search('unified', { user_id: 'first', query: 'cobalt', top_k: 100 }), expected);
  restarted.search('unified', { user_id: 'second', query: 'cobalt', top_k: 100 });
  assert.equal(restarted.scopes.size, 1);
});

test('in-flight body admission returns retryable 429 and releases capacity after invalid JSON', async t => {
  const service = { variant: 'lossless', search: () => ({ data: [] }) };
  const server = createServer({ service, apiKey: 'operation-test-key', maxInFlight: 1 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/search`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer operation-test-key' };
  const incomplete = http.request(url, { method: 'POST', headers });
  const finished = new Promise(resolve => incomplete.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }));
  const arrived = new Promise(resolve => server.once('request', resolve));
  incomplete.write('{');
  await arrived;
  const rejected = await fetch(url, { method: 'POST', headers, body: '{}' });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('retry-after'), '5');
  await rejected.text();
  incomplete.end('bad');
  assert.equal(await finished, 400);
  const recovered = await fetch(url, { method: 'POST', headers, body: '{}' });
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { data: [] });
});
