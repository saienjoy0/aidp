'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sw = read('service_worker.js');
const side = read('sidepanel.js');
const content = read('content.js');
const manifest = JSON.parse(read('manifest.json'));
const ok = (v,m) => { if (!v) throw new Error(m); };

ok(manifest.version === '0.7.9.422', 'R2 manifest version');
ok(side.includes('aidp_sidepanel_state_v2_t'), 'sidepanel state v2 must be case-scoped');
ok(side.includes('stableCaseKey(url, taskIdentity'), 'sidepanel must bind stable case identity');
ok(side.includes('lastFocusedWindow: true'), 'active tab must be preferred');
const getStart = side.indexOf('async function getAidpTab()');
const getEnd = side.indexOf('async function switchViewTo', getStart);
const getBody = side.slice(getStart, getEnd);
ok(getBody.indexOf('lastFocusedWindow: true') < getBody.indexOf('if (viewTabId != null)'), 'active tab must beat previous pin');
ok(side.includes('case_instance_key: String(caseInstanceKey || \'\')'), 'export must freeze case instance key');
ok(side.includes('setInterval(() => { if (!document.hidden) void updateTabBadge(); }, 3000)'), 'same-route item changes must be detected');

ok(content.includes('function detectTaskIdentity()'), 'content must extract Call ID / question ID');
ok(content.includes('^BGM$'), 'BGM speaker must be accepted');

ok(sw.includes('const activeExportJobs = new Map()'), 'exports must be tracked per tab');
ok(sw.includes('exportJobStorageKey(tabId)'), 'export job state must be tab-scoped');
ok(sw.includes('activeExportJobs.set(sourceTabId, job)'), 'per-tab export registration');
ok(sw.includes('activeExportJobs.size > 0'), 'mutation must retain global export lock');
ok(sw.includes('stableCaseKeyFromPing(url, contentPing)'), 'snapshot case key must include stable task identity');
ok(sw.includes('expectedCaseInstanceKey'), 'export must verify frozen case identity');
ok(sw.includes('書き出し中に別案件へ切り替わりました'), 'mid-export case swap must STOP');
console.log('beta42_qc_oneclick_r2_isolation.test.js: PASS');
