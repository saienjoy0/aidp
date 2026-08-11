'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'patch_engine.js'), 'utf8');
const context = { console, structuredClone: global.structuredClone };
context.globalThis = context;
vm.runInNewContext(code, context, { filename: 'patch_engine.js' });
const engine = context.AIDPPatchEngine;
assert(engine, 'AIDPPatchEngine must be exported');

const region = {
  region_id: 'region_1',
  start: 1,
  end: 3,
  duration: 2,
  text: '元字幕',
  speaker: '1',
  keep: '保留',
  voice_type: '说话',
  quality: '无问题',
  round_id: 1,
  table: { page: 1 }
};
const snapshot = {
  caseData: {
    case_key: '/management/task-v2/1/mark-v3/1',
    snapshot_id: 'snap-1',
    source_fingerprint: 'fp-1',
    duration_sources: { platform_wave_sec: 30 }
  },
  regionsData: { regions: [region] },
  ruleset: {
    time_rules: {
      normal_region_max_sec: 10,
      lyrics_exempt_from_10_sec: true
    }
  }
};
const patch = {
  schema: 'aidp-chatgpt-patch/v3',
  case_key: snapshot.caseData.case_key,
  source_snapshot_id: snapshot.caseData.snapshot_id,
  source_fingerprint: snapshot.caseData.source_fingerprint,
  operations: [{
    op_id: 'op-1',
    type: 'update_region',
    region_id: 'region_1',
    expected: {
      start: 1,
      end: 3,
      text: '元字幕',
      speaker: '1',
      keep: '保留',
      voice_type: '说话'
    },
    set: { start: 1.1, end: 2.9, text: '修正字幕' },
    reason: 'test'
  }]
};

const result = engine.dryRun(patch, snapshot, {
  featureFlags: {
    update_region: true,
    set_labels: false,
    split_region: false,
    add_region: false,
    delete_region: false
  }
});
assert.strictEqual(result.applicable, true, JSON.stringify(result, null, 2));
assert.strictEqual(result.operations[0].status, 'applicable');
assert.strictEqual(result.operations[0].after.text, '修正字幕');
assert.strictEqual(result.operations[0].after.start, 1.1);
assert.strictEqual(result.operations[0].after.end, 2.9);

const bad = JSON.parse(JSON.stringify(patch));
bad.source_fingerprint = 'wrong';
const rejected = engine.dryRun(bad, snapshot, { featureFlags: { update_region: true } });
assert.strictEqual(rejected.applicable, false);
assert(rejected.errors.some(item => item.includes('source_fingerprint')));

console.log('patch_engine.test.js: PASS');
