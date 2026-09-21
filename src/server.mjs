import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MemoryService, ContractError } from './memory.mjs';

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
export function createServer({ service, apiKey, allowUnauthenticated = false, maxBodyBytes = 16 * 1024 * 1024, maxInFlight = 16, version = '0.1.0' }) {
  if (!apiKey && !allowUnauthenticated) throw new Error('AML_MEMORY_KEY is required; local smoke may explicitly allow no authentication');
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1) throw new Error('maxInFlight must be a positive integer');
  let inFlight = 0;
  return http.createServer(async (req, res) => {
    let admitted = false;
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/health' && req.method === 'GET') return send(res, 200, { status: 'ok', system: 'AILIS Memory', version, variant: service.variant, model_calls: false, tracks: ['textual', 'coding'] });
      const shared = /^\/(add|search)$/.exec(pathname);
      const match = shared ? [pathname, 'unified', shared[1]] : /^\/(textual|coding)\/(add|search)$/.exec(pathname);
      if (!match) throw new ContractError('Unknown endpoint', 404);
      if (req.method !== 'POST') throw new ContractError('POST required', 405);
      if (apiKey) {
        const supplied = req.headers['x-api-key'] || /^(?:Bearer|Token) (.+)$/.exec(req.headers.authorization || '')?.[1] || '';
        const actual = Buffer.from(supplied); const expected = Buffer.from(apiKey);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ContractError('Invalid credentials', 401);
      }
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new ContractError('application/json required', 415);
      if (inFlight >= maxInFlight) { res.setHeader('Retry-After', '5'); throw new ContractError('Memory service concurrency limit reached; retry later', 429); }
      inFlight++; admitted = true;
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) { send(res, 413, { detail: { reason: 'Request body exceeds configured limit' } }); req.resume(); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ContractError('Invalid JSON', 400); }
      const result = service[match[2]](match[1], body);
      send(res, 200, result);
    } catch (error) {
      send(res, error instanceof ContractError ? error.status : 500, { detail: { reason: error instanceof ContractError ? error.message : 'Internal memory error' } });
    } finally {
      if (admitted) inFlight--;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const host = process.env.AML_HOST || '127.0.0.1';
  const rootDir = path.resolve(process.env.AML_DATA_DIR || '.state');
  const allowUnauthenticated = process.env.AML_ALLOW_UNAUTHENTICATED === '1' && ['127.0.0.1', '::1', 'localhost'].includes(host);
  const apiKey = process.env.AML_MEMORY_KEY;
  if (!apiKey && !allowUnauthenticated) throw new Error('Set AML_MEMORY_KEY (or use AML_ALLOW_UNAUTHENTICATED=1 on loopback for local smoke)');
  fs.mkdirSync(rootDir, { recursive: true });
  const lock = path.join(rootDir, 'server.lock');
  // Production is launched by Linux `flock --no-fork`, whose lock is released on process exit.
  // Standalone launches retain the conservative PID-file lock.
  const externalLock = process.env.AML_EXTERNAL_LOCK === 'flock';
  if (externalLock && process.platform !== 'linux') throw new Error('External flock is supported only on Linux');
  if (!externalLock) {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
    process.on('exit', () => { if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock); });
  }
  const service = new MemoryService({ rootDir, variant: process.env.AML_VARIANT || 'lossless', maxCachedScopes: Number(process.env.AML_CACHE_SCOPES || 8), maxCachedBytes: Number(process.env.AML_CACHE_BYTES || 64 * 1024 * 1024) });
  const server = createServer({ service, apiKey, allowUnauthenticated, maxInFlight: Number(process.env.AML_MAX_IN_FLIGHT || 4), version: process.env.AML_VERSION || '0.1.0' });
  server.requestTimeout = 30 * 60 * 1000;
  server.listen(Number(process.env.AML_PORT || 8787), host, () => console.log(`AILIS AML ${service.variant}: http://${host}:${server.address().port} (no LLM)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
