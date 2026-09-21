import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MemoryService, ContractError } from '../src/memory.mjs';
import { createServer } from '../src/server.mjs';

function setup(t, variant = 'lossless') {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ailis-aml-test-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return { rootDir, service: new MemoryService({ rootDir, variant }) };
}
const add = (text, extra = {}) => ({ request_id: 'r1', user_id: 'u1', session_id: 's1', messages: [{ role: 'user', content: text }], ...extra });
const search = (query, extra = {}) => ({ query, user_id: 'u1', top_k: 100, ...extra });

test('vendored AILIS modules match the recorded SHA256 without algorithm changes', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../vendor/ailis/manifest.json', import.meta.url)));
  for (const item of manifest.files) assert.equal(createHash('sha256').update(fs.readFileSync(new URL(`../vendor/ailis/${item.target}`, import.meta.url))).digest('hex'), item.sha256);
});

for (const variant of ['native', 'lossless']) {
  test(`${variant}: synchronous visibility, idempotency, restart, conflict and source time`, t => {
    const { rootDir, service } = setup(t, variant);
    const body = add('spectrometer verification experiment', { messages: [{ role: 'assistant', content: 'spectrometer verification experiment', timestamp: 0 }] });
    const response = service.add('textual', body);
    assert.deepEqual(response, { success: true, request_id: 'r1', user_id: 'u1', session_id: 's1' });
    service.add('textual', body);
    assert.equal(service.diagnostics('textual', 'u1').searchableEvents, 1);
    const before = service.search('textual', search('spectrometer'));
    assert.equal(before.data.length, 1);
    assert.equal(before.data[0].created_at, '1970-01-01T00:00:00.000Z');
    const restarted = new MemoryService({ rootDir, variant });
    assert.deepEqual(restarted.search('textual', search('spectrometer')), before);
    restarted.add('textual', body);
    assert.equal(restarted.diagnostics('textual', 'u1').searchableEvents, 1);
    assert.throws(() => restarted.add('textual', add('conflicting body')), e => e instanceof ContractError && e.status === 409);
  });
  test(`${variant}: user, run, track and similar path IDs are isolated; sessions can be crossed`, t => {
    const { service } = setup(t, variant);
    for (const [user, track, text] of [['../u', 'textual', 'alpha private landmark'], ['..\\u', 'textual', 'beta private landmark'], ['../u', 'coding', 'gamma private landmark'], ['run2/u', 'textual', 'delta private landmark']]) service.add(track, add(text, { user_id: user }));
    assert.match(service.search('textual', search('landmark', { user_id: '../u' })).data[0].content, /alpha/);
    assert.equal(service.search('textual', search('beta', { user_id: '../u' })).data.length, 0);
    assert.match(service.search('coding', search('landmark', { user_id: '../u' })).data[0].content, /gamma/);
    assert.deepEqual(service.search('textual', search('landmark', { user_id: 'missing' })), { data: [] });
    service.add('textual', add('landmark changed', { request_id: 'r2', user_id: '../u', session_id: 's2' }));
    assert.equal(service.search('textual', search('landmark', { user_id: '../u' })).data.length, 2);
  });
}

test('lossless keeps long code, indentation and late evidence; native limitation is measured', t => {
  const { rootDir, service } = setup(t);
  const code = 'def render():\n    ' + 'padding = 0\n    '.repeat(130) + 'return zirconium_failure_sentinel\n';
  service.add('coding', add(code));
  assert.ok(service.search('coding', search('zirconium_failure_sentinel')).data[0].content.endsWith(code));
  const native = new MemoryService({ rootDir, variant: 'native' });
  native.add('coding', add(code));
  assert.equal(native.search('coding', search('zirconium_failure_sentinel')).data.length, 0);
});

test('schema rejects missing fields, images, invalid timestamps and bad top_k without writing', t => {
  const { service } = setup(t);
  for (const body of [{}, add('x', { user_id: '' }), add('x', { messages: [] }), add('x', { messages: [{ role: 'system', content: 'x' }] }), add('x', { messages: [{ role: 'user', content: [] }] }), add('x', { messages: [{ role: 'user', content: 'x', timestamp: 'today' }] })]) assert.throws(() => service.add('coding', body), ContractError);
  for (const top_k of [0, 101, 1.5, '10', null]) assert.throws(() => service.search('textual', search('x', { top_k })), ContractError);
  assert.equal(service.diagnostics('coding', 'u1').searchableEvents, 0);
});

test('HTTP endpoints enforce auth, shapes, retries, concurrent writes, count and empty results', async t => {
  const { service } = setup(t);
  const server = createServer({ service, apiKey: 'test-only-not-a-secret' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, extra = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-only-not-a-secret', ...extra }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await post('/textual/add', add('alpha'), { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await post('/textual/add', {})).status, 422);
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/textual/add', add(`concurrent evidence ${i}`, { request_id: `r${i}` }))));
  assert.ok(replies.every(r => r.status === 200));
  assert.equal(service.diagnostics('textual', 'u1').searchableEvents, 8);
  const result = await (await post('/textual/search', search('concurrent', { top_k: 3, options: ['A', 'B'] }))).json();
  assert.equal(result.data.length, 3);
  assert.ok(result.data.every(r => r.id && r.content));
  assert.deepEqual(await (await post('/coding/search', search('concurrent'))).json(), { data: [] });
  const longId = '../'.repeat(100) + 'scope';
  assert.equal((await post('/coding/add', add('evidence', { user_id: longId }))).status, 200);
});

test('recovery after durable journal commit but failed indexing does not duplicate or lose messages', t => {
  const { service } = setup(t);
  const original = service.indexRequest;
  service.indexRequest = () => { throw new Error('simulated indexing interruption'); };
  assert.throws(() => service.add('coding', add('recovery sentinel')), /interruption/);
  service.indexRequest = original;
  service.add('coding', add('recovery sentinel'));
  assert.equal(service.search('coding', search('recovery')).data.length, 1);
  assert.equal(service.diagnostics('coding', 'u1').committedRequests, 1);
});

test('one registration endpoint pair accepts dialogue and code without inferring track from text', async t => {
  const { service } = setup(t);
  const server = createServer({ service, apiKey: 'local-registration-test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'local-registration-test' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  await post('/add', add('orchid: I moved to Hangzhou.', { user_id: 'dialogue-run:user' }));
  const code = 'def orchid():\n    return 42\n';
  await post('/add', add(code, { user_id: 'coding-run:user' }));
  const dialogue = await post('/search', search('orchid', { user_id: 'dialogue-run:user' }));
  const coding = await post('/search', search('orchid', { user_id: 'coding-run:user' }));
  assert.equal(dialogue.data.length, 1);
  assert.match(dialogue.data[0].content, /Hangzhou/);
  assert.equal(coding.data.length, 1);
  assert.ok(coding.data[0].content.endsWith(code));
  assert.deepEqual(await post('/textual/search', search('orchid', { user_id: 'dialogue-run:user' })), { data: [] });
});
