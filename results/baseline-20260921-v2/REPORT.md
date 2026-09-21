# AILIS memory baseline report

Generated: 2026-09-21T04:04:08.504Z

Local evidence retrieval only; no Answer model, no AML Full run, no complete AILIS agent/profile-curator evaluation.

## Variants

- native: exact AILIS recordTurn/searchMemory; one imported message per event, 1,200-character per-role truncation and last-500-event search window remain in effect.
- lossless: adapter retains all original messages, whitespace and source metadata and calls the unchanged AILIS BM25/phrase/session-diversity ranker. This is an adapted baseline, not the untouched AILIS product.
- Both variants use the same message boundaries and query strings. No LLM, dense retrieval, semantic reranker, profile curator, answer generation or model costs.

## Public LoCoMo evidence retrieval

| Variant / condition | Questions | Recall@5 | Recall@10 | Recall@100 | All evidence@100 | MRR@100 |
|---|---:|---:|---:|---:|---:|---:|
| native | 1531 | 44.37% | 49.43% | 64.44% | 58.07% | 0.4048 |
| lossless | 1531 | 52.00% | 58.20% | 76.88% | 70.41% | 0.4650 |

Only original conversation text is ingested. Both human speakers map to user role; speaker and session date remain in text. Gold labels are used only after Search. Questions with absent or unresolved evidence are excluded and listed in summary.json. The 500-event window is measured at one message per event (production AILIS can group a user/assistant turn); the mapping affects effective retention. This is original LoCoMo, NOT the AML LoCoMo-Refined suite.

## Original coding diagnostics

| Variant / condition | Questions | Recall@5 | Recall@10 | Recall@100 | All evidence@100 | MRR@100 |
|---|---:|---:|---:|---:|---:|---:|
| native / relevant | 22 | 88.64% | 88.64% | 88.64% | 86.36% | 0.8864 |
| native / noisy | 22 | 84.85% | 87.12% | 88.64% | 86.36% | 0.8864 |
| lossless / relevant | 22 | 90.91% | 93.18% | 93.18% | 90.91% | 0.9318 |
| lossless / noisy | 22 | 89.39% | 91.67% | 93.18% | 90.91% | 0.9318 |

Small hand-authored cases: exact identifiers, multiple evidence pieces, temporal changes, rejected repairs, paraphrases, long code/log payloads. The noisy condition adds 180 fixed unrelated tickets. Scores measure retrieval of annotated evidence; they do not measure whether an agent solves a software task. These fixtures are NOT CAMBench.

## Retention stress (separate from main metrics)

| Variant / condition | Questions | Recall@5 | Recall@10 | Recall@100 | All evidence@100 | MRR@100 |
|---|---:|---:|---:|---:|---:|---:|
| native | 1 | 0.00% | 0.00% | 0.00% | 0.00% | 0.0000 |
| lossless | 1 | 100.00% | 100.00% | 100.00% | 100.00% | 1.0000 |

A known useful record followed by 520 unrelated messages tests whether old evidence remains searchable.

## Metric definitions

Recall@K is the fraction of annotated support messages retrieved, macro-averaged across eligible questions. All evidence@K is the fraction of questions for which every annotated support message is present. MRR@100 uses the rank of the first support message. Ranking positions after 100 are not measured. A returned record may omit useful content in native mode despite retaining its source ID; therefore evidence-ID recall can overstate answer sufficiency. Long-payload probes and protocol tests address this separately. No QA accuracy or official leaderboard score is claimed.

## Provenance and limits

AILIS commit: 92f73b8f9597f36066d8c0725d35f876546b1224. Exact module hashes: vendor/ailis/manifest.json. Data hash and sample/category breakdowns: summary.json. Per-query retrieved IDs and failure cases: details.json (local only).

Official Add/Search documentation: https://agentmemoryleaderboard.ai/api-guide
Public LoCoMo: https://github.com/snap-research/locomo

No official Smoke/Full run, evaluation key or public deployment was used. Open-source track's gpt-4o-mini requirement is unresolved for this no-LLM baseline: do not submit it as competition-ready without clarification or a compliant model stage.

LoCoMo category 5 (adversarial/unanswerable) excluded from support recall: 446 questions. Also excluded: 4 without evidence, 5 with unresolved references. Final scored set: 1531 questions. Explicit ID lists were expanded; malformed IDs were not guessed.
