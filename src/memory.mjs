import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AILISMemoryRuntime } = require('../vendor/ailis/ailis-memory-store.cjs');
const { rankMemoryEvents } = require('../vendor/ailis/ailis-memory-lexical-retriever.cjs');
export const variants = ['native', 'lossless'];
// unified is an internal scope for the single Add/Search pair requested by AML's application form.
export const tracks = ['textual', 'coding', 'unified'];
export const digest = value => createHash('sha256').update(value).digest('hex');

export class ContractError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const check = (condition, message) => { if (!condition) throw new ContractError(message); };
export function validateAdd(body) {
  check(body && typeof body === 'object' && !Array.isArray(body), 'JSON object required');
  for (const key of ['request_id', 'user_id', 'session_id']) check(nonempty(body[key]), `${key} must be a nonempty string`);
  check(Array.isArray(body.messages) && body.messages.length > 0, 'messages must be a nonempty array');
  const messages = body.messages.map((message, i) => {
    check(message && ['user', 'assistant'].includes(message.role), `messages[${i}].role must be user or assistant`);
    check(nonempty(message.content), `messages[${i}].content must be a nonempty string for textual/coding`);
    if (message.timestamp !== undefined) check(Number.isSafeInteger(message.timestamp) && Number.isFinite(new Date(message.timestamp).getTime()), `messages[${i}].timestamp must be Unix milliseconds`);
    return { role: message.role, content: message.content, ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }) };
  });
  return { request_id: body.request_id, user_id: body.user_id, session_id: body.session_id, messages };
}
export function validateSearch(body) {
  check(body && typeof body === 'object' && !Array.isArray(body), 'JSON object required');
  check(nonempty(body.query), 'query must be a nonempty string for textual/coding');
  check(nonempty(body.user_id), 'user_id must be a nonempty string');
  check(Number.isSafeInteger(body.top_k) && body.top_k >= 1 && body.top_k <= 100, 'top_k must be an integer in [1,100]');
  if (body.options !== undefined) check(Array.isArray(body.options) && body.options.every(nonempty), 'options must be an array of nonempty strings');
  return body;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  if (process.platform !== 'win32') {
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
}
function sourceEvent(track, userId, request, message, index) {
  return {
    id: `mem_${digest(JSON.stringify([track, userId, request.request_id, index]))}`,
    sessionId: request.session_id, ts: message.timestamp === undefined ? request.receivedAt : new Date(message.timestamp).toISOString(),
    userText: message.role === 'user' ? message.content : '',
    assistantText: message.role === 'assistant' ? message.content : '', importance: 1, tags: [],
    aml: { role: message.role, sessionId: request.session_id, timestamp: message.timestamp, requestId: request.request_id, messageIndex: index }
  };
}

// Protocol adaptation only: both variants use AILIS's unchanged ranker.
// Native measures recordTurn/searchMemory, including its existing truncation and 500-event window.
// Lossless keeps full input events and passes them to the same AILIS rankMemoryEvents function.
export class MemoryService {
  constructor({ rootDir, variant = 'lossless', maxCachedScopes = 8, maxCachedBytes = 64 * 1024 * 1024 }) {
    if (!variants.includes(variant)) throw new Error('Unknown memory variant');
    if (!rootDir) throw new Error('An explicit isolated rootDir is required');
    this.rootDir = path.resolve(rootDir, variant);
    this.variant = variant;
    if (!Number.isSafeInteger(maxCachedScopes) || maxCachedScopes < 1 || !Number.isSafeInteger(maxCachedBytes) || maxCachedBytes < 1) throw new Error('Cache limits must be positive integers');
    this.maxCachedScopes = maxCachedScopes;
    this.maxCachedBytes = maxCachedBytes;
    this.scopes = new Map();
    fs.mkdirSync(this.rootDir, { recursive: true });
  }
  trimCache() {
    // Cache eviction only: the complete journal remains on disk and is reloaded unchanged.
    let bytes = [...this.scopes.values()].reduce((total, scope) => total + scope.journalBytes, 0);
    for (const [key, scope] of this.scopes) {
      if (this.scopes.size <= this.maxCachedScopes && bytes <= this.maxCachedBytes) break;
      this.scopes.delete(key);
      bytes -= scope.journalBytes;
    }
  }
  scope(track, userId, create = true) {
    if (!tracks.includes(track)) throw new ContractError('Unknown track', 404);
    const key = `${track}/${digest(userId)}`;
    if (this.scopes.has(key)) {
      const scope = this.scopes.get(key);
      this.scopes.delete(key); this.scopes.set(key, scope);
      return scope;
    }
    const dir = path.join(this.rootDir, key);
    const file = path.join(dir, 'requests.json');
    if (!create && !fs.existsSync(file)) return null;
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { userId, requests: [] };
    if (saved.userId !== userId) throw new Error('Scope identity mismatch');
    const scope = { key, dir, file, saved, requests: new Map(saved.requests.map(r => [r.request_id, r])), events: [], runtime: null, journalBytes: fs.existsSync(file) ? fs.statSync(file).size : 0 };
    if (this.variant === 'native') {
      scope.runtime = new AILISMemoryRuntime({ rootDir: path.join(dir, 'derived-native'), workspaceRoot: dir });
      if (!scope.runtime.loaded) throw new Error('Native memory initialization failed');
      // This derived directory belongs only to the adapter. Rebuild from its committed journal.
      scope.runtime.clearMemory({ preserveSecrets: false });
    }
    for (const request of saved.requests) this.indexRequest(scope, track, userId, request);
    this.scopes.set(key, scope);
    this.trimCache();
    return scope;
  }
  indexRequest(scope, track, userId, request) {
    request.messages.forEach((message, index) => {
      const event = sourceEvent(track, userId, request, message, index);
      if (scope.runtime) {
        const result = scope.runtime.recordTurn({ sessionId: event.sessionId, userMessage: event.userText, assistantMessage: event.assistantText, source: 'aml_adapter' });
        if (!result.ok) throw new Error('Native write failed');
        result.event.aml = { ...event.aml, stableId: event.id, sourceTs: event.ts };
      } else scope.events.push(event);
    });
  }
  add(track, input) {
    const body = validateAdd(input);
    const scope = this.scope(track, body.user_id);
    const fingerprint = digest(JSON.stringify(body));
    const existing = scope.requests.get(body.request_id);
    if (existing && existing.fingerprint !== fingerprint) throw new ContractError('request_id already used with a different payload', 409);
    if (!existing) {
      const request = { ...body, fingerprint, receivedAt: new Date().toISOString() };
      try {
        // Atomic journal is authoritative: a retry/restart rebuilds a partially indexed write.
        atomicJson(scope.file, { userId: body.user_id, requests: [...scope.saved.requests, request] });
        this.indexRequest(scope, track, body.user_id, request);
        scope.saved.requests.push(request);
        scope.requests.set(body.request_id, request);
        scope.journalBytes = fs.statSync(scope.file).size;
        this.trimCache();
      } catch (error) {
        this.scopes.delete(scope.key);
        throw error;
      }
    }
    return { success: true, request_id: body.request_id, user_id: body.user_id, session_id: body.session_id };
  }
  search(track, input) {
    const body = validateSearch(input);
    const scope = this.scope(track, body.user_id, false);
    if (!scope) return { data: [] };
    // Options are accepted but not used by this frozen lexical baseline.
    const ranked = scope.runtime
      ? scope.runtime.searchMemory(body.query, { limit: body.top_k })
      : rankMemoryEvents(scope.events, body.query, { limit: body.top_k });
    return {
      data: ranked.events.map(event => {
        const provenance = event.aml;
        const header = { session_id: provenance.sessionId, role: provenance.role, ...(provenance.timestamp === undefined ? {} : { timestamp: provenance.timestamp }) };
        return {
          id: provenance.stableId || event.id,
          content: `${JSON.stringify(header)}\n${provenance.role === 'assistant' ? event.assistantText : event.userText}`,
          score: event.retrieval.adjustedScore ?? event.retrieval.score,
          created_at: provenance.sourceTs || event.ts
        };
      })
    };
  }
  release(track, userId) { this.scopes.delete(`${track}/${digest(userId)}`); }
  diagnostics(track, userId) {
    const scope = this.scope(track, userId, false);
    return { variant: this.variant, committedRequests: scope?.saved.requests.length || 0, searchableEvents: scope?.runtime?.state.events.length ?? scope?.events.length ?? 0 };
  }
}
