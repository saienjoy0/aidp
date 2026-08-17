# AIDP Bridge Beta 41 — Deferred Local Settlement

Date: 2026-08-17

## Live evidence that triggered this release

Beta 40 applied a two-operation update-only patch. The first operation targeted `region_28` start `15.18038 -> 15.08038`. The MAIN-world driver called `handleUpdateRegion`, then its local React/Neeko Model/Wave polling failed to observe convergence and aborted before operation 2. After Beta 40 reloaded the AIDP page, a fresh case export showed `region_28.start = 15.08038` persisted exactly, while `region_29` was untouched.

This proves the local Model/Wave polling window is not a reliable success/failure authority for ordinary updates. It can be stale while AIDP autosave/server state is already correct.

## Fix

- A synchronous `handleUpdateRegion` throw remains a hard failure.
- If the call returns but local Model/Wave do not converge inside the bounded diagnostic polling window, the operation is now marked `local_settlement_deferred` instead of failed.
- The patch transaction continues.
- Success still requires a matching final `SubmitTempItemAnswer` HTTP 200 whose full `data.regions` and `dataMap.regions` equal the expected final case state.
- Final authority remains the explicit reload-derived AIDP state.
- Hard wall-clock deadlines, one-shot apply authorization, tab isolation, STOP-FIRST unknown handling, and no automatic staging/submission remain unchanged.

## Why this is safer

The executor no longer mistakes stale client observation for a failed write. It also does not blindly declare success: transport/full-state ACK and reload verification are still mandatory.
