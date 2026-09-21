# Running AILIS Memory

The API performs no generation, embedding, or reranker model calls. It is a versioned lossless wrapper around the unchanged AILIS lexical ranker. Track eligibility is for the organizer to review.

## Runtime

Use Node.js 22+, one process per persistent data root, a dedicated unprivileged account, and a TLS reverse proxy. The deployment uses a standalone Node executable (not a Snap launcher), Caddy, and systemd. Secrets are supplied through a root-owned 0600 EnvironmentFile. The service owns only its memory directory.

For Linux crash-safe single-writer locking:

```sh
AML_EXTERNAL_LOCK=flock /usr/bin/flock --nonblock --no-fork /var/lib/ailis-aml/process.lock /path/to/node src/server.mjs
```

Supply the other environment variables through the process manager; never put the real key in a command line or Git. `Restart=on-failure` and `RestartSec=5` recover an abnormal process exit. The external lock is released by the OS; a second writer must fail to acquire it. Direct standalone launches use a conservative PID-file lock instead.

The authoritative request journal is atomically replaced and fsynced; Linux also fsyncs the containing directory. Restart or cache eviction reconstructs the derived events from the complete journal. A repeated request_id with an identical payload remains idempotent. Conflicting payloads return409.

## Limits

- 16 MiB JSON body; 30-minute request timeout; top_k 1–100.
- Deployment admits at most4 authenticated in-flight requests, with429 and Retry-After on overflow. Begin official jobs with Add=1 and Search=1.
- Cached scopes: at most8 and64 MiB combined serialized journal size; eviction does not discard evidence. A single very large scope can exceed the normal cache budget while it is processed.
- Ranking scans retained events; this is not a precomputed inverted-index database. Node heap, temporary parse/ranking allocations, and filesystem capacity must be monitored for large runs.
- The deployed cgroup has MemoryMax=1G and CPUQuota=50%. These are service limits on a shared8-vCPU host, not a dedicated machine entitlement.

## Verification

`npm test` checks the original module hashes, API contract, stable IDs, write retries, isolation, long evidence, interrupted indexing, cache reload and retryable overload behavior.

With `AML_MEMORY_KEY` set privately, `AML_PUBLIC_BASE=https://your-host/aml node scripts/http-smoke.mjs` runs original synthetic checks. `scripts/capacity-probe.mjs` measures synthetic data only and creates a uniquely named operator scope. Never pass private evaluation labels or answers into these scripts.

The deployed candidate passed14 tests on Windows and Linux,9 public checks with normal TLS verification, and10,000-message synthetic storage/retrieval. At0.5 CPU, synthetic Search P95 was approximately886ms. A forced crash restarted automatically, and100 evidence rows retained identical IDs/content. These are operator checks, not official AML Smoke/Full or competition accuracy.

## Maintenance and data

Keep the declared API, authentication and resource settings stable after formal acceptance. The operator plans availability through at least2026-11-04 and at least30 days after the relevant submission, whichever is later. The IP certificate uses Caddy ACME short-lived renewal; verify renewal and service health during maintenance.

Keep request payloads out of application access logs. Store evaluation data only for its current run, never for training, analytics or redistribution. After each run is complete and required review material is secured, delete its explicitly identified scopes within30 days unless the organizer grants a written extension. Pause the sole writer before filesystem cleanup, validate the resolved hash directories remain inside the configured data root, and never delete an active run or the parent storage directory. Cleanup is an operator responsibility; cache eviction is not data deletion.

If the candidate fails, stop only `ailis-aml.service`. Restore only the backed-up AML changes to the Caddy site, validate its configuration, and reload Caddy. Do not restore unrelated production databases or alter other AILIS services. Existing services have independent data, model credentials and processes.

## Reused code

See `vendor/ailis/manifest.json` and `vendor/ailis/LICENSE`. Original source: https://github.com/haowenGuo/AILIS . Vendor modules are unchanged. Operational additions affect HTTP handling, durable storage, caching and process supervision, not lexical ranking.
