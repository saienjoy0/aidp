# Fresh Beta40 export verification — 2026-08-17 06:36:04Z

Input case export: `AIDP_case_ac0f4a427633c5dd_20260817T063604Z.zip`

## Result

The fresh read-only Beta40 export is stable and exactly matches the known pre-restore state after the Beta38 timeout episode.

- Bridge export version: `0.7.9-beta.40`
- case: `/management/task-v2/7662960445883420462/mark-v3/1`
- snapshot: `sha256:0eea744d0f93feeb5a35a03220b1f5daf61872a74708c8c1ddac27f392343c29`
- fingerprint: `sha256:3ffbbe2890680a21841cc277fdfdba578b23286da076b532068ac0a79e2131f6`
- Model / Wave / Table: `20 / 20 / 20`
- triple match: PASS
- export guard: stable=true, same_case=true, same_fingerprint=true, same_counts=true
- snapshot diff from immediate inspection baseline: added=0, removed=0, changed=0

Therefore the 30-minute Beta38 hang did not leave any persistent partial mutation in the reload-derived server state captured here.

## Exact remaining known probe damage

Still present in this fresh export:

1. `region_28` start `15.18038` (probe-pre value was `15.08038`)
2. `region_29` start/end/text = `22.2604 / 23.7004 / 大きいのはこの2つだ！` (probe-pre values were `22.1604 / 23.6004 / 大きいのはこの2つだ。`)
3. split probe extra region `region_1786608670417_6xr2dyn` still exists
4. original `region_1786431519182_j1idsot` is still shortened to end `74.167542` instead of `79.980585`
5. deleted blank region `68.392113–72.132696` is still absent
6. deleted `region_40` equivalent `58.516693–62.436703 / おい待て、どこ行くこの野郎。 / spk5` is still absent

## Beta40 execution plan

Do not start with structural operations. Beta40 itself has not yet passed a live write after its runtime changes. First validate the guarded runtime with the two already-proven `update_region` corrections only.

Patch: `AIDP_BETA40_STAGE1_UPDATE_ONLY_VERIFIED.json`

Offline dry-run against this exact fresh export using Beta40 `patch_engine.js`:

- total=2
- applicable=2
- review_required=0
- rejected=0
- errors=[]

Only after Stage 1 apply + reload persistence succeeds should the remaining structural four-operation restore be regenerated from the new snapshot and run.
