// Original diagnostic fixtures, not CAMBench and not a software-engineering solve benchmark.
// Labels are consumed only by the evaluator, never passed to Add or Search.
export function codingDiagnostic() {
  const docs = [
    ['cfg-root', 'configuration', 'Config incident: load_config returned None for an empty YAML file. The caller in settings.py accessed config.get and raised AttributeError.'],
    ['cfg-fix', 'configuration', 'Validated repair: normalize empty YAML in load_config with config = safe_load(stream) or {}. test_empty_config and test_defaults passed.'],
    ['retry-failed', 'retry-first', 'FAILED attempt: retry every payment POST after a socket timeout. Integration tests created duplicate charges. This approach was rejected.'],
    ['retry-good', 'retry-final', 'Validated payment retry: create one idempotency key per logical purchase and reuse it across retries. The server stores the original outcome. test_duplicate_purchase passed.'],
    ['cache-old', 'cache-history', 'January cache policy for fetch_profile: TTL was 600 seconds. This old policy was later replaced.'],
    ['cache-new', 'cache-current', 'March decision for fetch_profile: TTL is now 30 seconds because permissions must refresh quickly. This supersedes the January setting.'],
    ['async-race', 'shutdown', 'Shutdown race: close_database ran before pending writes finished. The fix awaited all writer tasks before closing the connection. test_shutdown_flush passed.'],
    ['tx-rollback', 'transaction', 'Order transaction rule: inventory decrement and order insert must commit together. If insertion fails, rollback both changes; no independent inventory commit.'],
    ['path-win', 'filesystem', 'Windows file path failure: shell string concatenation split filenames containing spaces. The validated solution passes executable arguments as an array, with shell disabled.'],
    ['unicode', 'parser', 'Unicode parser bug: offsets counted UTF-16 code units while the protocol expected UTF-8 bytes. Repair: calculate Buffer.byteLength(segment, "utf8"). Test with 中文 and emoji.'],
    ['deps', 'architecture', 'Offline deployment constraint: the agent process must start without contacting an external package registry. All runtime dependencies are shipped in the installer.'],
    ['stream', 'streaming', 'SSE streaming incident: a JSON event was split across TCP chunks. Parsing each chunk failed. Accumulate bytes until a complete event delimiter, then decode JSON.'],
    ['cancel', 'jobs', 'Cancellation rule: mark a queued task cancelled before acquiring resources. Running tasks receive an AbortSignal and release their leases in finally.'],
    ['sql', 'database', 'Duplicate ingestion fix: the database has UNIQUE(tenant_id, request_id). An identical retried body returns the prior result; a changed body with the same ID returns conflict.'],
    ['security', 'security', 'Tenant search invariant: every index lookup is constrained by tenant_id from authenticated scope. A final result filter alone cannot prevent cross-tenant retrieval.'],
    ['restore', 'recovery', 'Crash recovery design: fsync the append journal before acknowledging a write. On restart replay committed entries and deduplicate stable operation IDs.'],
    ['code-tail', 'long-code', 'Historical build log:\n' + 'Compiling unchanged renderer component.\n'.repeat(90) + '\nFinal root cause: quartz_decoder rejected empty frames.\nValidated patch:\ndef decode_frame(frame):\n    if not frame:\n        return None\n    return quartz_decoder(frame)\n'],
    ['human', 'paraphrase', 'Rejected execution option: asynchronous work without awaiting settlement left rows unpersisted when the process exited. Explicit completion synchronization resolved it.'],
    ['cache-test', 'cache-verification', 'Verification for the March fetch_profile policy: advance the fake clock by 31 seconds and assert a second upstream request occurs.'],
    ['retry-test', 'retry-verification', 'Purchase retry validation: simulate a lost success response, repeat with the same idempotency key, and assert only one payment record exists.']
  ].map(([id, session, text]) => ({ id, session, text }));
  const questions = [
    ['config-root', 'exact', 'Why did load_config cause AttributeError on empty YAML?', ['cfg-root']],
    ['config-fix', 'exact', 'What validated repair handles empty YAML in load_config?', ['cfg-fix']],
    ['config-chain', 'multi_evidence', 'Find the root cause and tested fix for the empty configuration failure.', ['cfg-root', 'cfg-fix']],
    ['payment-rejected', 'failed_attempt', 'What happened when every payment POST was retried?', ['retry-failed']],
    ['payment-valid', 'exact', 'Which payment retry scheme passed test_duplicate_purchase?', ['retry-good']],
    ['payment-chain', 'multi_evidence', 'Find the failed payment retry attempt, the validated replacement and its regression test.', ['retry-failed', 'retry-good', 'retry-test']],
    ['cache-current', 'temporal', 'What is the current fetch_profile TTL?', ['cache-new']],
    ['cache-change', 'multi_evidence', 'How did the fetch_profile TTL change from January to March?', ['cache-old', 'cache-new']],
    ['cache-check', 'multi_evidence', 'Find the March fetch_profile policy and the test verifying its expiration.', ['cache-new', 'cache-test']],
    ['shutdown', 'exact', 'How was the close_database pending writes race fixed?', ['async-race']],
    ['transaction', 'exact', 'What happens to inventory if order insert fails?', ['tx-rollback']],
    ['windows', 'exact', 'How should Windows filenames containing spaces be passed to executables?', ['path-win']],
    ['unicode', 'exact', 'How were UTF-8 byte offsets computed correctly?', ['unicode']],
    ['offline', 'constraint', 'May the offline agent download runtime dependencies at startup?', ['deps']],
    ['sse', 'exact', 'How do we parse SSE JSON split across TCP chunks?', ['stream']],
    ['cancel', 'exact', 'What are the queued and running task cancellation rules?', ['cancel']],
    ['duplicate', 'exact', 'Which uniqueness constraint prevents duplicate ingestion per tenant?', ['sql']],
    ['isolation', 'constraint', 'Where should tenant_id constrain index retrieval?', ['security']],
    ['recovery', 'exact', 'How does the journal ensure acknowledged writes survive crash recovery?', ['restore']],
    ['tail', 'long_payload', 'What was the quartz_decoder empty frames fix?', ['code-tail']],
    ['synonym', 'paraphrase', 'Why did background saving disappear when the application shut down?', ['human']],
    ['once', 'paraphrase', 'How do we ensure a customer is billed only once when a successful response is lost?', ['retry-good', 'retry-test']]
  ].map(([id, category, question, evidence]) => ({ id, category, question, evidence }));
  const terms = ['configuration YAML load_config', 'payment retry timeout', 'fetch_profile TTL cache', 'shutdown pending writes', 'Windows filenames shell', 'UTF-8 Unicode parser', 'SSE JSON chunks', 'tenant index ingestion', 'journal crash recovery', 'cancellation tasks'];
  const noise = Array.from({ length: 180 }, (_, i) => ({
    id: `noise-${i}`, session: `unrelated-${i % 17}`,
    text: `Unrelated component ticket ${i}: ${terms[i % terms.length]}. This ticket concerns ${['dashboard styling', 'benchmark naming', 'documentation links', 'a metrics chart'][i % 4]}; recorded a documentation-only change, no runtime repair.`
  }));
  return { docs, questions, noise };
}
