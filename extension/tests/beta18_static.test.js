'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(message); };

const manifest = JSON.parse(read('manifest.json'));
const panel = read('sidepanel.html');
const panelJs = read('sidepanel.js');
const worker = read('service_worker.js');
const patch = read('patch_engine.js');
const content = read('content.js');
const offscreen = read('offscreen.js');
const recovery = read('recovery_engine.js');

assert(manifest.name.includes('Beta 18'), 'manifest Beta 18');
assert(content.includes("0.7.9-beta.18"), 'content version');
assert(worker.includes("0.7.9-beta.18"), 'worker version');
assert(offscreen.includes('0.7.9-beta.18'), 'offscreen version');
assert(panel.includes('Integrated Beta 18'), 'panel version');
assert(worker.includes("importScripts('patch_engine.js', 'recovery_engine.js')"), 'recovery engine imported');

const flags = worker.match(/const FEATURE_FLAGS = Object\.freeze\(\{([\s\S]*?)\}\);/i)?.[1] || '';
assert(/update_region:\s*true/.test(flags), 'update enabled');
assert(/set_labels:\s*false/.test(flags), 'labels remain disabled');
assert(/split_region:\s*true/.test(flags), 'split enabled');
assert(/add_region:\s*true/.test(flags), 'add enabled');
assert(/delete_region:\s*true/.test(flags), 'delete enabled');

assert(patch.includes("__aidp_bridge_native__"), 'dry-run uses non-production placeholders');
assert(patch.includes('makeStructuralPlaceholderId'), 'placeholder generator exists');
assert(!patch.includes('makeStructuralRegionId'), 'old synthetic production-ID generator removed');
assert(!patch.includes('fnv1a('), 'old production-ID hash generator removed');
assert(worker.includes("target.props.onChange(eventRegions)"), 'native add calls live template onChange');
assert(worker.includes("formal_id_generated_by_aidp: true"), 'native ID provenance recorded');
assert(worker.includes("resolveStructuralPlaceholderInJournal"), 'placeholder resolved into journal');
assert(worker.includes("dry_run_expected_result_fingerprint_provisional"), 'placeholder fingerprint marked provisional');
assert(worker.includes("refreshJournalExpectedFingerprint"), 'resolved fingerprint recomputed');
assert(worker.includes("performNativeControlledStructure(tabId, 'delete'"), 'controlled delete path used');
assert(worker.includes("performNativeControlledStructure(tabId, 'exact_add'"), 'known-ID recovery add path used');
assert(worker.includes("action === 'precheck'"), 'filter-aware timestamp precheck exists');
assert(recovery.includes('rollback_add_native_unresolved_id'), 'recovery handles crash before ID resolution');
assert(recovery.includes('rollback_split_native_unresolved_id'), 'split recovery handles unresolved native ID');
assert(panel.includes('構造変更の個別承認'), 'UI exposes explicit structural approval');
assert(panelJs.includes('AIDP_APPROVE_STRUCTURAL_DRY_RUN'), 'UI approval calls approval endpoint');
assert(panel.includes('話者フィルター中は構造変更・時刻変更を停止'), 'UI explains filter lock');

// The exact AIDP production-ID formula may appear only as a contract marker
// string used to verify the live template. Bridge code must not construct it.
const prodFormulaOccurrences = (worker.match(/region_\$\{Date\.now\(\)\}_\$\{Math\.random\(\)\.toString\(36\)\.substring\(2, 9\)\}/g) || []).length;
assert(prodFormulaOccurrences === 1, `production ID formula should occur once as contract marker, got ${prodFormulaOccurrences}`);
assert(worker.includes("raw.includes('region_${Date.now()}_${Math.random().toString(36).substring(2, 9)}')"), 'production formula occurrence is contract verification');

assert(!worker.includes('PointerEvent('), 'service worker does not use synthetic pointer events');
assert(!worker.includes('MouseEvent('), 'service worker does not use synthetic mouse events');
assert(!worker.includes('chrome.tabs.reload('), 'extension does not auto reload AIDP');
assert(!worker.includes('.click()'), 'service worker does not synthesize page clicks');
assert(!worker.includes('提出ボタン'), 'service worker does not automate submit UI');

console.log('beta18_static.test.js: PASS');
