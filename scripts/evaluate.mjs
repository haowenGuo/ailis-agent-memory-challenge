import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryService, digest } from '../src/memory.mjs';
import { codingDiagnostic } from '../evals/coding-diagnostic.mjs';
import { aggregate, scoreEvidence, latency, normalizeEvidence } from './metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const datasetPath = path.resolve(argument('--locomo', 'F:/AILIS_self_evolution_runtime/build-cache/benchmarks/locomo/data/locomo10.json'));
const limit = Number(argument('--samples', '10'));
const selectedVariants = argument('--variants', 'native,lossless').split(',');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(argument('--output', path.join(root, 'results', stamp)));
fs.mkdirSync(output, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/ailis/manifest.json'), 'utf8'));
const results = { createdAt: new Date().toISOString(), source: manifest, scope: 'Local evidence retrieval only; no Answer model, no AML Full run, no complete AILIS agent/profile-curator evaluation.', locomo: [], coding: [], stress: [] };
const details = [];
const stableId = (track, user, request, i) => `mem_${digest(JSON.stringify([track, user, request, i]))}`;
const flush = () => { fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(results, null, 2)); fs.writeFileSync(path.join(output, 'details.json'), JSON.stringify(details, null, 2)); };

function ingest(service, track, user, docs) {
  const mapping = new Map(); const durations = []; let sequence = 0; let batch = []; let session = null; let words = 0;
  function commit() {
    if (!batch.length) return;
    const request = `${track}-write-${sequence++}`;
    const payload = { request_id: request, user_id: user, session_id: session, messages: batch.map(d => ({ role: 'user', content: d.text })) };
    const before = performance.now(); service.add(track, payload); durations.push(performance.now() - before);
    batch.forEach((d, i) => mapping.set(d.id, stableId(track, user, request, i)));
    batch = []; words = 0;
  }
  for (const doc of docs) {
    const count = doc.text.split(/\s+/u).length;
    if (batch.length && (session !== doc.session || batch.length >= 20 || words + count > 2000)) commit();
    session = doc.session; batch.push(doc); words += count;
  }
  commit();
  return { mapping, durations };
}
function querySuite(service, track, user, questions, mapping, suite) {
  const rows = []; const times = []; const counts = []; const chars = []; const skipped = [];
  for (const question of questions) {
    if (suite === 'locomo' && question.category === 5) {
      skipped.push({ id: question.id, category: question.category, reason: 'adversarial_unanswerable_not_support_recall', missing: [] }); continue;
    }
    // Ground truth remains exclusively here. Neither support IDs nor answers enter API requests.
    const references = normalizeEvidence(question.evidence);
    if (!references.length || references.some(ref => !mapping.has(ref))) {
      skipped.push({ id: question.id, category: question.category, reason: !references.length ? 'no_evidence' : 'unresolved_evidence_reference', missing: references.filter(ref => !mapping.has(ref)) }); continue;
    }
    const expected = references.map(ref => mapping.get(ref));
    const before = performance.now();
    const response = service.search(track, { user_id: user, query: question.question, top_k: 100 });
    times.push(performance.now() - before); counts.push(response.data.length); chars.push(response.data.reduce((n, item) => n + item.content.length, 0));
    const actual = response.data.map(item => item.id);
    const metrics = scoreEvidence(actual, expected);
    rows.push({ ...metrics, category: question.category });
    const reverse = new Map([...mapping].map(([a, b]) => [b, a]));
    details.push({ suite, variant: service.variant, user, questionId: question.id, category: question.category, question: question.question, expected: references, retrieved: actual.map(id => reverse.get(id)), ...metrics });
  }
  return {
    ...aggregate(rows), rows,
    categories: Object.fromEntries([...new Set(rows.map(r => r.category))].map(category => [category, aggregate(rows.filter(r => r.category === category))])),
    searchLatency: latency(times), meanReturned: counts.length ? counts.reduce((a, b) => a + b) / counts.length : 0,
    meanReturnedChars: chars.length ? chars.reduce((a, b) => a + b) / chars.length : 0,
    skippedQuestions: skipped.length, skipped
  };
}

if (fs.existsSync(datasetPath)) {
  const bytes = fs.readFileSync(datasetPath);
  const dataset = JSON.parse(bytes.toString('utf8')).slice(0, limit);
  results.dataset = { sourcePath: datasetPath, sha256: digest(bytes), upstream: 'https://github.com/snap-research/locomo', selectedSamples: dataset.length, dataMode: 'Original public LoCoMo conversation text only. No observations, summaries, image captions, gold answers or evidence IDs are ingested. Both human speakers use user role; original names and session date strings prefix each message.' };
  for (const variant of selectedVariants) {
    const service = new MemoryService({ rootDir: path.join(output, 'state'), variant });
    const allRows = []; const samples = [];
    for (const sample of dataset) {
      const user = `locomo:${sample.sample_id}`;
      const conversation = sample.conversation;
      const sessions = Object.keys(conversation).filter(k => /^session_\d+$/.test(k)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
      const docs = sessions.flatMap(session => conversation[session].map(turn => ({ id: turn.dia_id, session, text: `${turn.speaker} [${conversation[`${session}_date_time`] || session}]: ${turn.text}` })));
      console.log(`[${variant}] LoCoMo ${sample.sample_id}: ingest ${docs.length} messages`);
      const { mapping, durations } = ingest(service, 'textual', user, docs);
      const questions = sample.qa.map((q, i) => ({ id: `${sample.sample_id}:q${i}`, question: q.question, evidence: q.evidence, category: q.category }));
      const measured = querySuite(service, 'textual', user, questions, mapping, 'locomo');
      allRows.push(...measured.rows); delete measured.rows;
      samples.push({ sampleId: sample.sample_id, inputMessages: docs.length, searchableMessages: service.diagnostics('textual', user).searchableEvents, addLatency: latency(durations), ...measured });
      console.log(`[${variant}] ${sample.sample_id}: ${measured.questions} scored, recall@10=${measured['recall@10'].toFixed(3)}, recall@100=${measured['recall@100'].toFixed(3)}`);
      service.release('textual', user);
    }
    results.locomo.push({ variant, ...aggregate(allRows), categories: Object.fromEntries([...new Set(allRows.map(r => r.category))].map(category => [category, aggregate(allRows.filter(r => r.category === category))])), samples });
    flush();
  }
} else { results.dataset = { status: 'missing', sourcePath: datasetPath }; console.log('LoCoMo dataset missing; running coding diagnostics only.'); }

const fixture = codingDiagnostic();
results.codingFixture = { source: 'Original hand-authored local diagnostic; not CAMBench', sha256: digest(fs.readFileSync(path.join(root, 'evals/coding-diagnostic.mjs'))) };
for (const variant of selectedVariants) {
  const service = new MemoryService({ rootDir: path.join(output, 'state'), variant });
  for (const condition of ['relevant', 'noisy']) {
    const user = `coding:${condition}`;
    // Same query set; fixed corpus conditions declared before scoring.
    const docs = condition === 'relevant' ? fixture.docs : [...fixture.docs, ...fixture.noise];
    const { mapping, durations } = ingest(service, 'coding', user, docs);
    const measured = querySuite(service, 'coding', user, fixture.questions, mapping, `coding-${condition}`);
    delete measured.rows;
    results.coding.push({ variant, condition, inputMessages: docs.length, addLatency: latency(durations), ...measured });
    console.log(`[${variant}] coding ${condition}: recall@5=${measured['recall@5'].toFixed(3)}, recall@100=${measured['recall@100'].toFixed(3)}`);
    service.release('coding', user);
  }
  const user = 'stress:retention';
  const docs = [
    { id: 'early', session: 'early', text: 'Historical fix: cobaltarchive requires preserving the original byte ordering.' },
    ...Array.from({ length: 520 }, (_, i) => ({ id: `filler-${i}`, session: 'later', text: `Routine changelog ${i}: updated dashboard spacing and documentation links.` }))
  ];
  const { mapping } = ingest(service, 'coding', user, docs);
  const measured = querySuite(service, 'coding', user, [{ id: 'early-memory', category: 'retention', question: 'What was the cobaltarchive byte ordering fix?', evidence: ['early'] }], mapping, 'retention-stress');
  delete measured.rows;
  results.stress.push({ variant, inputMessages: docs.length, searchableMessages: service.diagnostics('coding', user).searchableEvents, ...measured });
  flush();
}

const percent = n => n === null ? 'n/a' : `${(n * 100).toFixed(2)}%`;
const table = entries => ['| Variant / condition | Questions | Recall@5 | Recall@10 | Recall@100 | All evidence@100 | MRR@100 |', '|---|---:|---:|---:|---:|---:|---:|', ...entries.map(r => `| ${r.variant}${r.condition ? ` / ${r.condition}` : ''} | ${r.questions} | ${percent(r['recall@5'])} | ${percent(r['recall@10'])} | ${percent(r['recall@100'])} | ${percent(r['all@100'])} | ${r.mrr100?.toFixed(4)} |`)].join('\n');
const report = `# AILIS memory baseline report\n\nGenerated: ${results.createdAt}\n\n${results.scope}\n\n## Variants\n\n- native: exact AILIS recordTurn/searchMemory; one imported message per event, 1,200-character per-role truncation and last-500-event search window remain in effect.\n- lossless: adapter retains all original messages, whitespace and source metadata and calls the unchanged AILIS BM25/phrase/session-diversity ranker. This is an adapted baseline, not the untouched AILIS product.\n- Both variants use the same message boundaries and query strings. No LLM, dense retrieval, semantic reranker, profile curator, answer generation or model costs.\n\n## Public LoCoMo evidence retrieval\n\n${table(results.locomo)}\n\nOnly original conversation text is ingested. Both human speakers map to user role; speaker and session date remain in text. Gold labels are used only after Search. Questions with absent or unresolved evidence are excluded and listed in summary.json. The 500-event window is measured at one message per event (production AILIS can group a user/assistant turn); the mapping affects effective retention. This is original LoCoMo, NOT the AML LoCoMo-Refined suite.\n\n## Original coding diagnostics\n\n${table(results.coding)}\n\nSmall hand-authored cases: exact identifiers, multiple evidence pieces, temporal changes, rejected repairs, paraphrases, long code/log payloads. The noisy condition adds 180 fixed unrelated tickets. Scores measure retrieval of annotated evidence; they do not measure whether an agent solves a software task. These fixtures are NOT CAMBench.\n\n## Retention stress (separate from main metrics)\n\n${table(results.stress)}\n\nA known useful record followed by 520 unrelated messages tests whether old evidence remains searchable.\n\n## Metric definitions\n\nRecall@K is the fraction of annotated support messages retrieved, macro-averaged across eligible questions. All evidence@K is the fraction of questions for which every annotated support message is present. MRR@100 uses the rank of the first support message. Ranking positions after 100 are not measured. A returned record may omit useful content in native mode despite retaining its source ID; therefore evidence-ID recall can overstate answer sufficiency. Long-payload probes and protocol tests address this separately. No QA accuracy or official leaderboard score is claimed.\n\n## Provenance and limits\n\nAILIS commit: ${manifest.commit}. Exact module hashes: vendor/ailis/manifest.json. Data hash and sample/category breakdowns: summary.json. Per-query retrieved IDs and failure cases: details.json (local only).\n\nOfficial Add/Search documentation: https://agentmemoryleaderboard.ai/api-guide\nPublic LoCoMo: https://github.com/snap-research/locomo\n\nNo official Smoke/Full run, evaluation key or public deployment was used. Open-source track's gpt-4o-mini requirement is unresolved for this no-LLM baseline: do not submit it as competition-ready without clarification or a compliant model stage.\n`;
fs.writeFileSync(path.join(output, 'REPORT.md'), report);
fs.appendFileSync(path.join(output, 'REPORT.md'), '\nCategory 5 (adversarial/unanswerable) LoCoMo questions are excluded from support-evidence recall. Their linked history is not a correct-answer support label; abstention needs a separate Answer-stage evaluation. Explicit delimited evidence lists are split, while malformed IDs are never guessed.\n');
fs.writeFileSync(path.join(root, 'results', 'latest.json'), JSON.stringify({ output, summary: path.join(output, 'summary.json'), report: path.join(output, 'REPORT.md') }, null, 2));
console.log(`REPORT ${path.join(output, 'REPORT.md')}`);
