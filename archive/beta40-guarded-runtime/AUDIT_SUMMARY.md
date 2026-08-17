# Beta 40 final local audit

Date: 2026-08-17
Version: `0.7.9-beta.40`

## Why Beta 39 was stopped

A second audit found additional bugs/races that were not covered by the first Beta 39 pass. Beta 40 fixes them before another live write is attempted.

## Additional issues found and fixed

1. A mutation substep could begin too close to the global wall-clock deadline and finish after the UI had already timed out. Beta 40 propagates one absolute deadline and refuses to start a write without enough reserve.
2. Transaction-level STOP-FIRST was not sufficient because lower-level adapters could still issue inverse/compensation writes after uncertain failures. Normal apply now passes `disable_compensation: true` through update/add/delete/split.
3. Same-page stable state could incorrectly finalize a pending journal even though it might only be React/in-memory state. Journal outcome is now classified only after a different `page_instance_id` proves reload.
4. The same approved ③ dry-run token could remain available after a Port timeout. The Side Panel and worker now consume the token before mutation.
5. A mutation Port disconnect could expose an ambiguous retry path. The Side Panel now observes the persisted Journal and otherwise stops, requiring reload + fresh ZIP.
6. Baseline/report state had residual non-tab-scoped fallbacks. These are now tab-scoped.
7. Final UI audit found the Side Panel header still displayed `Beta 37`; it is now `Beta 40` and a version-sync regression test was added.
8. Cross-version journals are read/classified only. Beta 40 refuses to perform rollback writes using an older beta's journal.

## Current local tests

PASS:
- beta40_deadline_no_compensation.test.js
- beta40_guarded_runtime.test.js
- beta40_late_execution_guard.test.js
- beta40_one_shot_apply.test.js
- beta40_port_recovery.test.js
- beta40_recovery_wall.test.js
- beta40_reload_reconcile.test.js
- beta40_save_ack_semantics.test.js
- beta40_stop_first_failure.test.js
- beta40_version_sync.test.js
- patch_engine.test.js
- recovery_engine.test.js
- structural_patch_engine.test.js

`node --check` passes for all active runtime/core JavaScript files and `unzip -t` passes for the packaged release.

## Important status

This is a local/static-dynamic audit only. A live AIDP Beta 40 write has **not yet passed**. Because the Beta 38 attempt remained spinning for ~30 minutes, the current server state must be treated as unknown until explicit AIDP reload + fresh case ZIP export.

Next live action: install/reload Beta 40 → reload AIDP once → **do not press ③** → export a fresh case ZIP with ①.
