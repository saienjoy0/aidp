# AIDP Bridge beta38 — transaction settlement

Current release line: `0.7.9-beta.38`.

## Why beta38 exists

A fresh beta37 case export after a failed restore showed that rollback returned the AIDP case exactly to the pre-restore snapshot/fingerprint. The remaining executor problem was the save-settlement strategy: normal apply waited for a scoped `SubmitTempItemAnswer` ACK after every operation and then also required a 2.5-second no-more-saves quiet period. AIDP can legitimately emit multiple autosaves in a burst, so that design could make a valid transaction look stuck or time out.

## beta38 behavior

- one `SubmitTempItemAnswer` trace for the whole patch transaction
- no per-operation 30-second save wait during normal apply
- after all operations and AIDP-issued structural IDs are resolved, require one HTTP 200 payload whose complete `data.regions` and `dataMap.regions` equal the final expected state
- no 2.5-second quiet-period gate
- reload/persistence verification remains the final authority
- per-tab state isolation, Side Panel watchdog, journal/rollback remain enabled
- `暫存` and `提交` are never auto-clicked

Files in this directory:
- `BETA38_IMPLEMENTATION_REPORT.md` — design/change record
- `beta37_to_beta38.patch` — exact runtime diff from beta37
- `AIDP_BETA38_RESTORE_ALL_PROBE_DAMAGE.json` — current-case cleanup patch validated offline against snapshot `sha256:0eea744d...`

Local packaged release SHA-256: `c83c612cc990b942051bc568cc35a7fec813f7adc8dc78440c1161677db62124`.
