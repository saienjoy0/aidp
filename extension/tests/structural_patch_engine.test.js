'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'patch_engine.js'), 'utf8');
const context = { console, structuredClone: global.structuredClone, Date, Math };
context.globalThis = context;
vm.runInNewContext(code, context, { filename: 'patch_engine.js' });
const engine = context.AIDPPatchEngine;

const regions = [
  { region_id: 'region_1', start: 0, end: 2, duration: 2, text: 'A', speaker: '1', keep: '保留', voice_type: '说话', quality: '无问题', round_id: 1 },
  { region_id: 'region_2', start: 3, end: 7, duration: 4, text: 'B B', speaker: '1', keep: '保留', voice_type: '说话', quality: '无问题', round_id: 2 },
  { region_id: 'region_3', start: 10, end: 12, duration: 2, text: 'C', speaker: '1', keep: '保留', voice_type: '说话', quality: '无问题', round_id: 3 }
];
const snapshot = {
  caseData: {
    case_key: '/management/task-v2/1/mark-v3/1',
    snapshot_id: 'snap-struct',
    source_fingerprint: 'fp-struct',
    generated_at: '2026-08-02T11:30:00.000Z',
    duration_sources: { platform_wave_sec: 30 }
  },
  regionsData: { regions },
  ruleset: { time_rules: { normal_region_max_sec: 10, lyrics_exempt_from_10_sec: true } }
};
const expected = region => ({
  start: region.start,
  end: region.end,
  text: region.text,
  speaker: region.speaker,
  keep: region.keep,
  voice_type: region.voice_type
});
const patch = {
  schema: 'aidp-chatgpt-patch/v3',
  case_key: snapshot.caseData.case_key,
  source_snapshot_id: snapshot.caseData.snapshot_id,
  source_fingerprint: snapshot.caseData.source_fingerprint,
  operations: [
    {
      op_id: 'split-1', type: 'split_region', region_id: 'region_2', expected: expected(regions[1]),
      parts: [
        { start: 3, end: 4.8, text: 'B' },
        { start: 5.1, end: 7, text: 'B' }
      ], reason: 'split test', requires_user_review: true
    },
    {
      op_id: 'add-1', type: 'add_region',
      region: { start: 8, end: 9, text: 'NEW' },
      reason: 'add test', requires_user_review: true
    },
    {
      op_id: 'delete-1', type: 'delete_region', region_id: 'region_3', expected: expected(regions[2]),
      reason: 'delete test', requires_user_review: true
    }
  ]
};
const flags = { update_region: true, set_labels: false, split_region: true, add_region: true, delete_region: true };
const review = engine.dryRun(patch, snapshot, { featureFlags: flags });
assert.strictEqual(review.applicable, false);
assert.strictEqual(review.counts.review_required, 3, JSON.stringify(review, null, 2));

const approved = engine.dryRun(patch, snapshot, {
  featureFlags: flags,
  approvedStructuralOpIds: ['split-1', 'add-1', 'delete-1']
});
assert.strictEqual(approved.applicable, true, JSON.stringify(approved, null, 2));
assert.strictEqual(approved.counts.applicable, 3);
assert.strictEqual(approved.simulated_regions.length, 4);
assert.deepStrictEqual(Array.from(approved.simulated_fingerprint_payload, item => item.round_id), [1, 2, 3, 4]);
assert(!approved.simulated_fingerprint_payload.some(item => item.region_id === 'region_3'));
const generated = approved.simulated_fingerprint_payload.filter(item => !['region_1', 'region_2', 'region_3'].includes(item.region_id));
assert.strictEqual(generated.length, 2);
assert(generated.every(item => /^__aidp_bridge_native__/.test(item.region_id)), JSON.stringify(generated, null, 2));
assert(generated.every(item => !/^region_\d+_[a-z0-9]+$/.test(item.region_id)));
assert(approved.operations.every(item => Array.isArray(item.expected_regions_after)));
assert.strictEqual(approved.operations[0].expected_regions_after.length, 4);
assert.strictEqual(approved.operations[1].expected_regions_after.length, 5);
assert.strictEqual(approved.operations[2].expected_regions_after.length, 4);
assert.strictEqual(engine.isStructuralPlaceholderId(generated[0].region_id), true);

const nonNativeAdd = JSON.parse(JSON.stringify(patch));
nonNativeAdd.operations = [{
  op_id: 'bad-add', type: 'add_region',
  region: { start: 8, end: 9, text: 'NEW', speaker: '2' },
  requires_user_review: true
}];
const badAdd = engine.dryRun(nonNativeAdd, snapshot, { featureFlags: flags, approvedStructuralOpIds: ['bad-add'] });
assert.strictEqual(badAdd.applicable, false);
assert(badAdd.operations[0].errors.some(x => x.includes('speaker=1')));

const nonNativeSplitSnapshot = JSON.parse(JSON.stringify(snapshot));
nonNativeSplitSnapshot.regionsData.regions[1].speaker = '2';
const splitOnly = JSON.parse(JSON.stringify(patch));
splitOnly.operations = [patch.operations[0]];
const badSplit = engine.dryRun(splitOnly, nonNativeSplitSnapshot, { featureFlags: flags, approvedStructuralOpIds: ['split-1'] });
assert.strictEqual(badSplit.applicable, false);
assert(badSplit.operations[0].errors.some(x => x.includes('native split')));

console.log('structural_patch_engine.test.js: PASS');
