export const cutoffs = [1, 5, 10, 100];
export function normalizeEvidence(references) {
  return [...new Set((Array.isArray(references) ? references : []).flatMap(value => {
    if (typeof value !== 'string') return [String(value)];
    // Only split explicit lists. Never guess malformed or nonexistent IDs.
    return /^D\d+:\d+(?:[\s;,]+D\d+:\d+)*$/.test(value.trim())
      ? value.trim().split(/[\s;,]+/) : [value];
  }))];
}
export function scoreEvidence(actualIds, expectedIds) {
  const expected = new Set(expectedIds);
  if (!expected.size) throw new Error('Evidence scoring requires nonempty gold support');
  const result = {};
  for (const k of cutoffs) {
    const retrieved = new Set(actualIds.slice(0, k));
    const found = [...expected].filter(id => retrieved.has(id)).length;
    result[`recall@${k}`] = found / expected.size;
    result[`all@${k}`] = Number(found === expected.size);
  }
  const rank = actualIds.findIndex(id => expected.has(id));
  result.mrr100 = rank < 0 ? 0 : 1 / (rank + 1);
  return result;
}
export function aggregate(rows) {
  const average = key => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : null;
  return { questions: rows.length, ...Object.fromEntries([...cutoffs.flatMap(k => [`recall@${k}`, `all@${k}`]), 'mrr100'].map(key => [key, average(key)])) };
}
export function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
  return { n: sorted.length, p50ms: pick(0.5), p95ms: pick(0.95), maxMs: sorted.at(-1) ?? null };
}
