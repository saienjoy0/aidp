'use strict';

const assert = require('assert');
const engine = require('../recovery_engine.js');

const r = (id, start, end, text, round, extra = {}) => ({
  region_id: id, start, end, text, speaker: '1', keep: '保留', voice_type: '说话', quality: '无问题', round_id: round, ...extra
});

const backup = [
  r('region_1', 0, 2, 'A', 1),
  r('region_47', 166.7607, 179.776, 'LONG', 2)
];
const splitFirst = r('region_47', 166.7607, 174.05, 'FIRST', 2);
const splitSecond = r('region_journal_created', 174.31, 179.776, 'SECOND', 3);
const splitOp = {
  type: 'split_region', region_id: 'region_47', before: backup[1], after: [splitFirst, splitSecond]
};

// Regression: Beta13-like partial split left only a newly-created empty-text orphan.
const orphanState = [backup[0], backup[1], { ...splitSecond, text: '' }];
const orphan = engine.classifyStep({ currentRegions: orphanState, previousRegions: backup, operation: splitOp });
assert.strictEqual(orphan.safe, true, JSON.stringify(orphan, null, 2));
assert.strictEqual(orphan.mode, 'rollback_split_second_only');
assert.deepStrictEqual(orphan.actions.map(x => x.type), ['remove_region']);

// Full split can be reversed by removing the created region and restoring the original first region.
const fullSplit = engine.classifyStep({ currentRegions: [backup[0], splitFirst, splitSecond], previousRegions: backup, operation: splitOp });
assert.strictEqual(fullSplit.safe, true);
assert.strictEqual(fullSplit.mode, 'rollback_split_full');
assert.deepStrictEqual(fullSplit.actions.map(x => x.type), ['remove_region', 'restore_region']);

// A manual edit to the created region must block automatic deletion.
const editedOrphan = engine.classifyStep({ currentRegions: [backup[0], backup[1], { ...splitSecond, text: 'USER EDIT' }], previousRegions: backup, operation: splitOp });
assert.strictEqual(editedOrphan.safe, false);
assert.strictEqual(editedOrphan.mode, 'conflict');

// An unrelated user edit must block structural recovery.
const unrelatedEdited = engine.classifyStep({ currentRegions: [{ ...backup[0], text: 'CHANGED' }, backup[1], { ...splitSecond, text: '' }], previousRegions: backup, operation: splitOp });
assert.strictEqual(unrelatedEdited.safe, false);

// round_id changes alone are tolerated during intermediate classification; final fingerprint still verifies exact backup.
const renumberedOrphan = engine.classifyStep({
  currentRegions: [{ ...backup[0], round_id: 10 }, { ...backup[1], round_id: 11 }, { ...splitSecond, text: '', round_id: 12 }],
  previousRegions: backup,
  operation: splitOp
});
assert.strictEqual(renumberedOrphan.safe, true);
assert.strictEqual(renumberedOrphan.mode, 'rollback_split_second_only');

// add_region: remove only the exact journal-created region.
const add = r('region_added', 3, 4, 'NEW', 3);
const addOp = { type: 'add_region', before: null, after: add };
const addClass = engine.classifyStep({ currentRegions: [...backup, add], previousRegions: backup, operation: addOp });
assert.strictEqual(addClass.mode, 'rollback_add');
assert.deepStrictEqual(addClass.actions.map(x => x.type), ['remove_region']);

// delete_region: re-add only when the rest of the state is untouched.
const delOp = { type: 'delete_region', before: backup[0], after: null, region_id: 'region_1' };
const delClass = engine.classifyStep({ currentRegions: [backup[1]], previousRegions: backup, operation: delOp });
assert.strictEqual(delClass.mode, 'rollback_delete');
assert.deepStrictEqual(delClass.actions.map(x => x.type), ['add_region']);

// update_region can be recognized in both post-change and already-restored states.
const updated = { ...backup[0], text: 'B' };
const updateOp = { type: 'update_region', region_id: 'region_1', before: backup[0], after: updated };
assert.strictEqual(engine.classifyStep({ currentRegions: [updated, backup[1]], previousRegions: backup, operation: updateOp }).mode, 'rollback_update');
assert.strictEqual(engine.classifyStep({ currentRegions: backup, previousRegions: backup, operation: updateOp }).mode, 'already_restored');


// Exact regression shape from the Beta13/Beta16 orphan incident: a generated
// second split region survived with empty text while the original first region
// was already back at its pre-split value.
const incidentBefore = r('region_47', 166.7607, 179.776,
  'GOOD Evening Mr President 俺は大使ようこそ General you can understand our Concern Assassination in a nightclub Shooting in Tijuana Bombing in Guadalajara Nobody wants an Unstable Neighbor。', 19);
const incidentSecond = r('region_1785680637086_x3duart', 174.31, 179.776,
  'Assassination in a nightclub Shooting in Tijuana Bombing in Guadalajara Nobody wants an Unstable Neighbor。', 20);
const incident = engine.classifyStep({
  currentRegions: [incidentBefore, { ...incidentSecond, text: '' }],
  previousRegions: [incidentBefore],
  operation: {
    type: 'split_region',
    region_id: 'region_47',
    before: incidentBefore,
    after: [
      { ...incidentBefore, end: 174.05, text: 'GOOD Evening Mr President 俺は大使ようこそ General you can understand our Concern' },
      incidentSecond
    ]
  }
});
assert.strictEqual(incident.safe, true, JSON.stringify(incident, null, 2));
assert.strictEqual(incident.mode, 'rollback_split_second_only');
assert.strictEqual(incident.actions[0].region_id, 'region_1785680637086_x3duart');

// Beta18: if AIDP generated the formal ID but the service worker stopped before
// persisting the placeholder -> formal-ID mapping, recovery may remove exactly
// one region that matches the placeholder's geometry/default metadata.
const nativePlaceholder = r('__aidp_bridge_native__add-1__0', 20, 21, 'NATIVE', 3);
const nativeActual = r('region_1786431517361_gs1yqnr', 20, 21, '', 3);
const nativeAddClass = engine.classifyStep({
  currentRegions: [...backup, nativeActual],
  previousRegions: backup,
  operation: { type: 'add_region', after: nativePlaceholder }
});
assert.strictEqual(nativeAddClass.safe, true, JSON.stringify(nativeAddClass, null, 2));
assert.strictEqual(nativeAddClass.mode, 'rollback_add_native_unresolved_id');
assert.strictEqual(nativeAddClass.actions[0].region_id, nativeActual.region_id);

const nativeSplitSecond = r('__aidp_bridge_native__split-1__1', 174.31, 179.776, 'SECOND', 3);
const nativeSplitActual = r('region_1786431519182_j1idsot', 174.31, 179.776, '', 3);
const nativeSplitClass = engine.classifyStep({
  currentRegions: [backup[0], splitFirst, nativeSplitActual],
  previousRegions: backup,
  operation: {
    type: 'split_region', region_id: 'region_47', before: backup[1],
    after: [splitFirst, nativeSplitSecond]
  }
});
assert.strictEqual(nativeSplitClass.safe, true, JSON.stringify(nativeSplitClass, null, 2));
assert.strictEqual(nativeSplitClass.mode, 'rollback_split_native_unresolved_id');
assert.strictEqual(nativeSplitClass.actions[0].region_id, nativeSplitActual.region_id);
assert.deepStrictEqual(nativeSplitClass.actions.map(x => x.type), ['remove_region', 'restore_region']);

const ambiguousNative = engine.classifyStep({
  currentRegions: [...backup, nativeActual, r('region_1786431519999_other', 20, 21, '', 4)],
  previousRegions: backup,
  operation: { type: 'add_region', after: nativePlaceholder }
});
assert.strictEqual(ambiguousNative.safe, false);

console.log('recovery_engine.test.js: PASS');
