import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreEvidence, normalizeEvidence } from '../scripts/metrics.mjs';
test('explicit evidence lists are split while malformed references are never silently repaired', () => {
  assert.deepEqual(normalizeEvidence(['D8:6; D9:17', 'D8:6', 'D21:18 D21:22']), ['D8:6', 'D9:17', 'D21:18', 'D21:22']);
  assert.deepEqual(normalizeEvidence(['D:11:26', 'D', 'D30:05']), ['D:11:26', 'D', 'D30:05']);
});
test('evidence metrics distinguish partial coverage, duplicates and complete multihop support', () => {
  const metrics = scoreEvidence(['irrelevant', 'a', 'a', 'noise', 'b'], ['a', 'b']);
  assert.equal(metrics['recall@1'], 0);
  assert.equal(metrics['recall@5'], 1);
  assert.equal(metrics['all@5'], 1);
  assert.equal(metrics.mrr100, 0.5);
  assert.equal(scoreEvidence(['a'], ['a', 'b'])['recall@100'], 0.5);
  assert.equal(scoreEvidence(['a'], ['a', 'b'])['all@100'], 0);
  assert.throws(() => scoreEvidence([], []));
});
