'use strict';

importScripts('patch_engine.js');

const VERSION = '0.7.9-beta.16';
const OFFSCREEN_URL = 'offscreen.html';
const RULESET_URL = 'ruleset.json';
const EXPORT_PORT_NAME = 'AIDP_EXPORT_JOB_V1';
const EXPORT_JOB_STORAGE_KEY = 'aidp_export_job_v1';
const AIDP_PATH_RE = /^\/management\/task-v2\/([^/]+)\/mark-v3\/([^/]+)$/;
const TIME_TOLERANCE = {
  tableVsModel: 0.0025,
  waveVsModel: 0.0005,
  mediaRange: 0.05
};

const APPLY_SETTLEMENT = {
  initialDelayMs: 900,
  pollIntervalMs: 1100,
  timeoutMs: 30000
};
const ROLLBACK_SETTLEMENT = {
  pollIntervalMs: 1000,
  timeoutMs: 20000,
  stableMatchesRequired: 2
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function round6(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

let rulesetCache = null;
async function loadRuleset() {
  if (rulesetCache) return cloneJson(rulesetCache);
  const response = await fetch(chrome.runtime.getURL(RULESET_URL));
  if (!response.ok) throw new Error(`ruleset.jsonを読み込めません（HTTP ${response.status}）`);
  rulesetCache = await response.json();
  return cloneJson(rulesetCache);
}

async function sanitizeMediaUrl(raw) {
  if (!raw) {
    return {
      found: false,
      origin: '',
      path_sha256: '',
      url_sha256: '',
      query_present: false,
      raw_url_included: false
    };
  }
  try {
    const url = new URL(raw);
    return {
      found: true,
      origin: url.origin,
      path_sha256: `sha256:${await sha256Text(url.pathname)}`,
      url_sha256: `sha256:${await sha256Text(raw)}`,
      query_present: Boolean(url.search),
      raw_url_included: false
    };
  } catch (_) {
    return {
      found: true,
      origin: '',
      path_sha256: '',
      url_sha256: `sha256:${await sha256Text(String(raw))}`,
      query_present: false,
      raw_url_included: false,
      parse_error: true
    };
  }
}

let activeExportJob = null;

async function writeExportJobState(patch) {
  const previous = activeExportJob?.state || {};
  const state = {
    schema: 'aidp-export-job/v1',
    version: VERSION,
    updated_at: new Date().toISOString(),
    ...previous,
    ...patch
  };
  if (activeExportJob) activeExportJob.state = state;
  try { await chrome.storage.session.set({ [EXPORT_JOB_STORAGE_KEY]: state }); }
  catch (_) {}
  return state;
}

async function progress(text, percent) {
  const payload = { type: 'AIDP_EXPORT_PROGRESS', text, percent, job_id: activeExportJob?.id || '' };
  let deliveredToPort = false;
  if (activeExportJob) {
    await writeExportJobState({
      job_id: activeExportJob.id,
      status: 'running',
      text,
      percent: Number.isFinite(Number(percent)) ? Number(percent) : null
    });
    try {
      activeExportJob.port?.postMessage(payload);
      deliveredToPort = Boolean(activeExportJob.port);
    } catch (_) {}
  }
  if (!deliveredToPort) {
    try { await chrome.runtime.sendMessage(payload); }
    catch (_) {}
  }
}

async function getActiveAidpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('現在のタブを取得できません');
  const url = new URL(tab.url);
  if (url.origin !== 'https://aidp.bytedance.com' || !AIDP_PATH_RE.test(url.pathname)) {
    throw new Error('AIDPの案件画面（mark-v3）を開いてください');
  }
  return { tab, url };
}

function validateContentPing(response) {
  if (!response?.ok) throw new Error('AIDP content adapterから正常な応答を取得できません');
  if (response.version !== VERSION) {
    throw new Error(`AIDPページのcontent adapter版が一致しません（page=${response.version || 'unknown'}, extension=${VERSION}）。AIDPページを手動で再読み込みしてください`);
  }
  if (!response.page_instance_id) throw new Error('AIDPページ固有IDを取得できません。AIDPページを手動で再読み込みしてください');
  return response;
}

async function pingContent(tabId) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, { type: 'AIDP_CONTENT_PING' });
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    response = await chrome.tabs.sendMessage(tabId, { type: 'AIDP_CONTENT_PING' });
  }
  return validateContentPing(response);
}

function collectNeekoMainWorld() {
  const round = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(9)) : null;
  const scalar = value => {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.map(scalar);
    return String(value);
  };
  const plainRegion = region => {
    const out = {};
    for (const key of ['id', 'start', 'end', 'yuan_text', 'if_save', 'is_qualified', 'music', 'speaker_desc', 'round_id', 'color', 'drag', 'resize', 'loop']) {
      try {
        if (region?.[key] !== undefined) out[key] = ['start', 'end'].includes(key) ? round(region[key]) : scalar(region[key]);
      } catch (_) {}
    }
    if (!out.id) {
      try { out.id = scalar(region?.data?.id || region?.element?.dataset?.id || ''); } catch (_) {}
    }
    return out;
  };

  const seeds = [
    ...document.querySelectorAll('.neeko-wavesurfer,.neeko-wavesurfer-warper,wave,region.waver-region[data-id]')
  ];
  const candidates = [];
  const seenFibers = new Set();

  for (const seed of seeds) {
    let own = [];
    try { own = Object.getOwnPropertyNames(seed); } catch (_) {}
    const key = own.find(name => name.startsWith('__reactFiber$'));
    if (!key) continue;
    let fiber = seed[key];
    for (let depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
      if (seenFibers.has(fiber)) continue;
      seenFibers.add(fiber);
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        if (!props || typeof props !== 'object') continue;
        const variants = [props, props.$api?.props].filter(Boolean);
        for (const variant of variants) {
          let regions = null;
          try {
            if (variant.regions && typeof variant.regions[Symbol.iterator] === 'function') regions = Array.from(variant.regions);
          } catch (_) {}
          const api = props.$api || variant.$api || null;
          const ref = api?.componentRef?.current || api?.$componentRef?.current || null;
          const methods = ['getWavesurferInstance', 'handleUpdateRegion', 'handleAddRegion', 'handleRemoveRegion', 'handleChooseRegion'];
          const methodCount = methods.filter(name => typeof ref?.[name] === 'function').length;
          let score = 0;
          if (regions?.length) score += 8;
          if (variant.regionsControlled === true) score += 5;
          if (methodCount) score += methodCount * 3;
          if (/wavesurfer/i.test(String(api?.id || api?.$xpath || fiber.type?.displayName || fiber.elementType?.displayName || ''))) score += 7;
          if (score >= 8) candidates.push({ score, props: variant, api, ref, fiber, regions });
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  if (!best) {
    return {
      ok: false,
      error: 'Neeko wavesurferのReactコンポーネントを検出できません',
      capability: { react_fiber_found: seenFibers.size > 0, neeko_component_found: false },
      model_regions: [], wave_regions: [], media_url: ''
    };
  }

  const modelRegions = (best.regions || []).map(plainRegion).filter(region => region.id);
  let ws = null;
  try { ws = best.ref?.getWavesurferInstance?.() || null; } catch (_) {}
  let waveRegions = [];
  try {
    const list = ws?.regions?.list || {};
    waveRegions = Object.values(list).map(plainRegion).filter(region => region.id);
  } catch (_) {}

  const methods = {};
  const methodMetadata = {};
  for (const name of ['getWavesurferInstance', 'handleUpdateRegion', 'handleAddRegion', 'handleRemoveRegion', 'handleChooseRegion']) {
    methods[name] = typeof best.ref?.[name] === 'function';
    methodMetadata[name] = methods[name] ? {
      name: String(best.ref[name].name || name),
      arity: Number(best.ref[name].length),
      source_prefix: (() => {
        try { return String(best.ref[name]).slice(0, 3000); } catch (_) { return ''; }
      })()
    } : null;
  }

  const safeOwnKeys = value => {
    try { return value && typeof value === 'object' ? Object.getOwnPropertyNames(value).slice(0, 160) : []; }
    catch (_) { return []; }
  };
  const scalarField = (value, key) => {
    try {
      const item = value?.[key];
      return item == null || ['string', 'number', 'boolean'].includes(typeof item) ? item ?? null : null;
    } catch (_) { return null; }
  };
  const collectionLength = value => {
    try {
      if (Array.isArray(value)) return value.length;
      if (value && typeof value.size === 'number') return value.size;
      if (value && typeof value === 'object') return Object.keys(value).length;
    } catch (_) {}
    return null;
  };
  const storeCandidates = [];
  let cursor = best.fiber;
  for (let depth = 0; cursor && depth < 30; depth += 1, cursor = cursor.return) {
    for (const [source, value] of [
      ['memoizedProps', cursor.memoizedProps],
      ['pendingProps', cursor.pendingProps],
      ['memoizedState', cursor.memoizedState],
      ['stateNode', cursor.stateNode]
    ]) {
      if (!value || typeof value !== 'object') continue;
      const roots = [
        ['self', value],
        ['data', value.data],
        ['dataMap', value.dataMap],
        ['props', value.props]
      ];
      for (const [path, root] of roots) {
        if (!root || typeof root !== 'object') continue;
        const regionCollection = root.regions;
        const keys = safeOwnKeys(root);
        const hasAggregate = keys.some(key => ['valid_duration', 'valid_region_count', 'duration'].includes(key));
        if (regionCollection == null && !hasAggregate) continue;
        const signature = `${depth}:${source}:${path}`;
        if (storeCandidates.some(item => item.signature === signature)) continue;
        storeCandidates.push({
          signature,
          depth,
          source,
          path,
          keys,
          regions_kind: Array.isArray(regionCollection) ? 'array' : typeof regionCollection,
          regions_count: collectionLength(regionCollection),
          valid_duration: scalarField(root, 'valid_duration'),
          valid_region_count: scalarField(root, 'valid_region_count'),
          duration: scalarField(root, 'duration')
        });
      }
    }
  }

  const wsRegionApi = {};
  try {
    const regionContainer = ws?.regions || null;
    for (const name of ['addRegion', 'removeRegion', 'clear', 'clearRegions', 'getCurrentRegion']) {
      const owner = typeof ws?.[name] === 'function' ? ws : regionContainer;
      const fn = owner?.[name];
      wsRegionApi[name] = typeof fn === 'function' ? {
        name: String(fn.name || name),
        arity: Number(fn.length),
        source_prefix: (() => {
          try { return String(fn).slice(0, 3000); } catch (_) { return ''; }
        })()
      } : null;
    }
  } catch (_) {}

  const modelRegionKeys = [...new Set(modelRegions.flatMap(region => Object.keys(region)))].sort();
  const waveRegionKeys = [...new Set(waveRegions.flatMap(region => Object.keys(region)))].sort();

  let duration = null;
  try { duration = round(ws?.getDuration?.()); } catch (_) {}
  let mediaUrl = '';
  try { mediaUrl = String(best.props?.src || best.api?.props?.src || ''); } catch (_) {}

  return {
    ok: true,
    adapter: 'aidp-neeko-react-fiber-v1',
    capability: {
      react_fiber_found: true,
      neeko_component_found: true,
      component_api_found: Boolean(best.ref),
      api_id: String(best.api?.id || ''),
      api_xpath: String(best.api?.$xpath || ''),
      regions_controlled: best.props?.regionsControlled === true,
      region_can_drag: best.props?.regionCanDrag === true,
      region_can_resize: best.props?.regionCanResize === true,
      is_using_new_version: best.props?.isUsingNewVersion === true,
      methods
      ,method_metadata: methodMetadata,
      component_ref_keys: safeOwnKeys(best.ref).sort(),
      component_prop_keys: safeOwnKeys(best.props).sort(),
      model_region_keys: modelRegionKeys,
      wave_region_keys: waveRegionKeys,
      wavesurfer_keys: safeOwnKeys(ws).sort(),
      wavesurfer_region_api: wsRegionApi,
      store_candidates: storeCandidates.slice(0, 40)
    },
    model_regions: modelRegions,
    wave_regions: waveRegions,
    duration,
    media_url: mediaUrl
  };
}

async function collectMainWorld(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: collectNeekoMainWorld
  });
  return result?.[0]?.result || { ok: false, error: 'MAIN worldの結果がありません' };
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function numericClose(a, b, tolerance) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= tolerance;
}

function canonicalRegion(region) {
  return {
    region_id: String(region.region_id || ''),
    start: round6(region.start),
    end: round6(region.end),
    text: normalizeText(region.text),
    speaker: String(region.speaker ?? ''),
    keep: String(region.keep ?? ''),
    voice_type: String(region.voice_type ?? ''),
    quality: String(region.quality ?? ''),
    round_id: Number.isFinite(Number(region.round_id)) ? Number(region.round_id) : null
  };
}

function speakerRelation(a, b) {
  const sa = String(a.speaker || '').trim();
  const sb = String(b.speaker || '').trim();
  if (!sa || !sb || /^unk$/i.test(sa) || /^unk$/i.test(sb)) return 'unknown';
  return sa === sb ? 'same' : 'different';
}

function classifyOverlap(a, b, overlapSeconds) {
  const eps = 0.0005;
  let geometry = 'partial_overlap';
  if (a.start <= b.start + eps && a.end >= b.end - eps) geometry = 'a_contains_b';
  else if (b.start <= a.start + eps && b.end >= a.end - eps) geometry = 'b_contains_a';

  const relation = speakerRelation(a, b);
  const involvesDiscarded = a.keep === '丢弃' || b.keep === '丢弃';
  let classification = 'review_required';
  let reason = '重複が正しい同時発話か、音声と映像による確認が必要です';
  if (involvesDiscarded) {
    classification = 'informational';
    reason = '丢弃小条を含むため、通常の保留小条重複警告から分離します';
  } else if (relation === 'same') {
    classification = 'rule_warning';
    reason = '同一話者の隣接小条は原則として重複不可です';
  }
  return {
    a: a.region_id,
    b: b.region_id,
    seconds: round6(overlapSeconds),
    geometry,
    speaker_relation: relation,
    keep_relation: `${a.keep || '未取得'} / ${b.keep || '未取得'}`,
    classification,
    reason
  };
}

function mergeAndValidate(table, main, ruleset) {
  const errors = [];
  const ruleWarnings = [];
  const reviewRequired = [];
  const informational = [];
  const tableRegions = table.regions || [];
  const modelRegions = main.model_regions || [];
  const waveRegions = main.wave_regions || [];
  const tableMap = new Map(tableRegions.map(region => [region.region_id, region]));
  const modelMap = new Map(modelRegions.map(region => [region.id, region]));
  const waveMap = new Map(waveRegions.map(region => [region.id, region]));
  const tableIds = new Set(tableMap.keys());
  const modelIds = new Set(modelMap.keys());
  const waveIds = new Set(waveMap.keys());

  if (!main.ok) errors.push(main.error || 'Neekoモデルを取得できません');
  if (!sameSet(modelIds, tableIds)) errors.push(`ModelとTableのID集合が一致しません（${modelIds.size}/${tableIds.size}）`);
  if (!sameSet(modelIds, waveIds)) errors.push(`ModelとWaveのID集合が一致しません（${modelIds.size}/${waveIds.size}）`);
  if (table.restore_error) reviewRequired.push(`ページ復元警告: ${table.restore_error}`);

  const allIds = [...new Set([...modelIds, ...tableIds, ...waveIds])];
  const regions = [];
  for (const id of allIds) {
    const model = modelMap.get(id);
    const row = tableMap.get(id);
    const wave = waveMap.get(id);
    if (model && row) {
      if (!numericClose(model.start, row.start, TIME_TOLERANCE.tableVsModel)) errors.push(`${id}: Model.start=${model.start} / Table.start=${row.start}`);
      if (!numericClose(model.end, row.end, TIME_TOLERANCE.tableVsModel)) errors.push(`${id}: Model.end=${model.end} / Table.end=${row.end}`);
      if (normalizeText(model.yuan_text) !== normalizeText(row.text)) errors.push(`${id}: ModelとTableの字幕が一致しません`);
      if (row.keep && String(model.if_save || '') !== row.keep) reviewRequired.push(`${id}: 保留状態の表示差 ${model.if_save} / ${row.keep}`);
      if (row.voice_type && String(model.music || '') !== row.voice_type) reviewRequired.push(`${id}: 人声类型の表示差 ${model.music} / ${row.voice_type}`);
      if (row.speaker && String(model.speaker_desc || '') !== row.speaker && !row.speaker_values?.includes(String(model.speaker_desc || ''))) {
        reviewRequired.push(`${id}: 話者表示の差 ${model.speaker_desc} / ${row.speaker}`);
      }
    }
    if (model && wave) {
      if (!numericClose(model.start, wave.start, TIME_TOLERANCE.waveVsModel)) errors.push(`${id}: Model.startとWave.startが一致しません`);
      if (!numericClose(model.end, wave.end, TIME_TOLERANCE.waveVsModel)) errors.push(`${id}: Model.endとWave.endが一致しません`);
    }

    const source = model || {
      id,
      start: row?.start ?? wave?.start,
      end: row?.end ?? wave?.end,
      yuan_text: row?.text || '',
      if_save: row?.keep || '',
      music: row?.voice_type || '',
      speaker_desc: row?.speaker || '',
      round_id: row?.display_number || null,
      is_qualified: ''
    };
    regions.push({
      region_id: id,
      start: round6(source.start),
      end: round6(source.end),
      duration: round6(Number(source.end) - Number(source.start)),
      text: normalizeText(source.yuan_text),
      speaker: String(source.speaker_desc ?? ''),
      speaker_desc: null,
      keep: String(source.if_save ?? ''),
      voice_type: String(source.music ?? ''),
      quality: String(source.is_qualified ?? ''),
      round_id: Number.isFinite(Number(source.round_id)) ? Number(source.round_id) : null,
      table: row ? {
        page: row.page,
        row_in_page: row.row_in_page,
        display_number: row.display_number,
        speaker_display: row.speaker,
        speaker_values: row.speaker_values
      } : null,
      source_alignment: {
        model_present: Boolean(model),
        wave_present: Boolean(wave),
        table_present: Boolean(row)
      }
    });
  }

  regions.sort((a, b) => {
    const ar = Number.isFinite(a.round_id) ? a.round_id : Number.MAX_SAFE_INTEGER;
    const br = Number.isFinite(b.round_id) ? b.round_id : Number.MAX_SAFE_INTEGER;
    return ar - br || a.start - b.start || a.region_id.localeCompare(b.region_id);
  });

  const roundIds = regions.map(r => r.round_id).filter(Number.isFinite);
  if (new Set(roundIds).size !== roundIds.length) errors.push('round_idが重複しています');

  const maxNormalDuration = Number(ruleset?.time_rules?.normal_region_max_sec ?? 10);
  for (const region of regions) {
    if (!(Number.isFinite(region.start) && Number.isFinite(region.end) && region.end > region.start)) {
      errors.push(`${region.region_id}: start/endが不正です`);
      continue;
    }
    if (!region.keep) reviewRequired.push(`${region.region_id}: 保留／丢弃を取得できません`);
    if (!region.voice_type) reviewRequired.push(`${region.region_id}: 人声类型を取得できません`);
    if (!region.speaker) reviewRequired.push(`${region.region_id}: 話者番号を取得できません`);

    if (region.duration > maxNormalDuration) {
      const label = `${region.region_id}: ${maxNormalDuration}秒超（${region.duration.toFixed(3)}秒）`;
      if (region.voice_type === '歌词' && ruleset?.time_rules?.lyrics_exempt_from_10_sec) {
        informational.push(`${label}・歌词のため上限対象外`);
      } else if (region.keep === '丢弃') {
        informational.push(`${label}・丢弃小条のため通常警告から分離`);
      } else {
        ruleWarnings.push(label);
      }
    }
  }

  const byStart = [...regions].sort((a, b) => a.start - b.start || a.end - b.end);
  const overlaps = [];
  for (let i = 0; i < byStart.length; i += 1) {
    for (let j = i + 1; j < byStart.length && byStart[j].start < byStart[i].end; j += 1) {
      const overlap = Math.min(byStart[i].end, byStart[j].end) - Math.max(byStart[i].start, byStart[j].start);
      if (overlap <= 0.0005) continue;
      const item = classifyOverlap(byStart[i], byStart[j], overlap);
      overlaps.push(item);
      const text = `${item.a} / ${item.b}: ${item.seconds.toFixed(3)}秒重複（${item.geometry}, 話者=${item.speaker_relation}）`;
      if (item.classification === 'rule_warning') ruleWarnings.push(text);
      else if (item.classification === 'review_required') reviewRequired.push(text);
      else informational.push(text);
    }
  }

  const validRegions = regions.filter(region => region.keep === '保留');
  const validDuration = round6(validRegions.reduce((sum, region) => sum + Math.max(0, region.end - region.start), 0));
  const platformDuration = Number.isFinite(Number(main.duration)) && Number(main.duration) > 0
    ? round6(main.duration)
    : round6(Math.max(0, ...regions.map(region => region.end)));
  const maxEnd = Math.max(0, ...regions.map(region => region.end));
  const outOfPlatformRange = regions
    .filter(region => platformDuration && region.end > platformDuration + TIME_TOLERANCE.mediaRange)
    .map(region => ({
      region_id: region.region_id,
      end: region.end,
      platform_duration: platformDuration,
      exceed_sec: round6(region.end - platformDuration)
    }));
  for (const item of outOfPlatformRange) {
    ruleWarnings.push(`${item.region_id}: 終了${item.end.toFixed(3)}秒がAIDP波形長${item.platform_duration.toFixed(3)}秒を${item.exceed_sec.toFixed(3)}秒超過`);
  }

  return {
    regions,
    errors,
    rule_warnings: ruleWarnings,
    review_required: reviewRequired,
    informational,
    warnings: [...ruleWarnings, ...reviewRequired],
    overlaps,
    counts: { model: modelRegions.length, wave: waveRegions.length, table: tableRegions.length },
    valid_region_count: validRegions.length,
    valid_duration: validDuration,
    platform_duration: platformDuration,
    max_region_end: round6(maxEnd),
    out_of_platform_range: outOfPlatformRange,
    triple_match: errors.length === 0 && sameSet(modelIds, tableIds) && sameSet(modelIds, waveIds)
  };
}

async function buildSnapshot(tab, url, table, main, ruleset, contentPing) {
  const merged = mergeAndValidate(table, main, ruleset);
  const fingerprintPayload = merged.regions.map(canonicalRegion);
  const sourceFingerprint = `sha256:${await sha256Text(JSON.stringify(fingerprintPayload))}`;
  const snapshotId = `sha256:${await sha256Text(`${url.pathname}\n${sourceFingerprint}`)}`;
  const caseHash = (await sha256Text(url.pathname)).slice(0, 16);
  const mediaUrl = main.media_url || table.media_url || '';
  const media = await sanitizeMediaUrl(mediaUrl);
  const match = url.pathname.match(AIDP_PATH_RE);
  const generatedAt = new Date().toISOString();

  const validation = {
    triple_match: merged.triple_match,
    errors: merged.errors,
    rule_warnings: merged.rule_warnings,
    review_required: merged.review_required,
    informational: merged.informational,
    warnings: merged.warnings,
    overlap_count: merged.overlaps.length,
    overlaps: merged.overlaps,
    platform_range: {
      platform_duration: merged.platform_duration,
      max_region_end: merged.max_region_end,
      out_of_range: merged.out_of_platform_range
    },
    audio_content_checks_not_claimed: [
      '前後留白0.5秒超',
      '小条内部の1秒以上の無音',
      '音声と字幕の意味的一致',
      '同時発話・話者識別',
      '映像との同期'
    ]
  };

  const caseData = {
    schema: 'aidp-case/v3',
    generated_at: generatedAt,
    bridge_version: VERSION,
    case_key: url.pathname,
    case_id: match?.[1] || '',
    mark_index: match?.[2] || '',
    case_hash: caseHash,
    snapshot_id: snapshotId,
    source_fingerprint: sourceFingerprint,
    page_title: tab.title || table.title || '',
    language: table.document_language || '',
    language_source: table.document_language ? 'document.lang' : 'not_detected',
    template_id: url.searchParams.get('templateID') || '',
    template_type: url.searchParams.get('templateType') || '',
    duration: merged.platform_duration,
    duration_sources: {
      platform_wave_sec: merged.platform_duration,
      decoded_media_sec: null,
      decoded_minus_platform_sec: null
    },
    total_region_count: merged.regions.length,
    valid_region_count: merged.valid_region_count,
    valid_duration: merged.valid_duration,
    source_media: media,
    ruleset: {
      name: ruleset.ruleset_name,
      version: ruleset.ruleset_version,
      source_sha256: ruleset.source_sha256
    },
    page_instance_id: contentPing?.page_instance_id || '',
    document_time_origin_ms: Number(contentPing?.document_time_origin_ms || 0) || null,
    adapter: {
      table: 'aidp-arco-table-pagination-v2',
      model: main.adapter || 'unavailable',
      content_version: contentPing?.version || '',
      triple_source_validation: true
    },
    validation_summary: {
      triple_match: validation.triple_match,
      error_count: validation.errors.length,
      rule_warning_count: validation.rule_warnings.length,
      review_required_count: validation.review_required.length,
      informational_count: validation.informational.length,
      overlap_count: validation.overlap_count,
      media_warning_count: 0
    },
    chatgpt_contract: {
      default_editable_fields: ['start', 'end', 'text'],
      restricted_fields_requiring_separate_user_confirmation: ['speaker', 'keep', 'voice_type'],
      structural_operations_requiring_individual_approval: ['split_region', 'add_region', 'delete_region'],
      submit_automation: false
    }
  };

  const regionsData = {
    schema: 'aidp-regions-snapshot/v3',
    generated_at: generatedAt,
    case_key: url.pathname,
    snapshot_id: snapshotId,
    source_fingerprint: sourceFingerprint,
    time_precision: 6,
    regions: merged.regions
  };

  const capabilities = {
    schema: 'aidp-bridge-capabilities/v3',
    generated_at: generatedAt,
    bridge_version: VERSION,
    action_taken: 'none',
    modifications_enabled: true,
    feature_flags: {
      update_region: true,
      set_labels: false,
      split_region: true,
      add_region: true,
      delete_region: true
    },
    page_structure: table.structure,
    pagination: {
      original_page: table.original_page,
      restored_page: table.restored_page,
      restore_error: table.restore_error,
      page_counts: table.page_counts
    },
    neeko: main.capability || {},
    counts: merged.counts,
    validation,
    ruleset_loaded: true,
    ruleset_version: ruleset.ruleset_version,
    known_internal_methods_are_reported_but_not_invoked: false,
    debugger_permission_used: false,
    raw_media_url_in_export: false,
    media_path_in_export: false
  };

  const summary = {
    case_key: url.pathname,
    total_region_count: merged.regions.length,
    valid_region_count: merged.valid_region_count,
    valid_duration: merged.valid_duration,
    duration: merged.platform_duration,
    duration_sources: caseData.duration_sources,
    counts: merged.counts,
    source_fingerprint: sourceFingerprint,
    snapshot_id: snapshotId,
    media: { found: Boolean(mediaUrl), origin: media.origin || '' },
    validation,
    previous_snapshot_diff: null,
    export_guard: null
  };

  return {
    caseData,
    regionsData,
    capabilities,
    summary,
    mediaUrl,
    canonicalRegions: fingerprintPayload
  };
}

async function collectSnapshot(progressBase = 0) {
  const { tab, url } = await getActiveAidpTab();
  const ruleset = await loadRuleset();
  const contentPing = await pingContent(tab.id);
  await progress('AIDP表を先頭ページから巡回しています…', Math.max(progressBase, 10));
  const tableResponse = await chrome.tabs.sendMessage(tab.id, { type: 'AIDP_COLLECT_TABLE' });
  if (!tableResponse?.ok) throw new Error(tableResponse?.error || '表データ取得に失敗しました');
  await progress('React FiberからNeekoモデルと波形状態を読み取っています…', Math.max(progressBase + 12, 28));
  const main = await collectMainWorld(tab.id);
  await progress('Model・Wave・Tableを三重照合しています…', Math.max(progressBase + 20, 40));
  const snapshot = await buildSnapshot(tab, url, tableResponse.result, main, ruleset, contentPing);
  return { tab, url, ruleset, ...snapshot };
}

function baselineStorageKey(caseHash) {
  return `aidp_bridge_baseline_${caseHash}`;
}

async function readBaseline(caseHash) {
  const key = baselineStorageKey(caseHash);
  const value = await chrome.storage.local.get(key);
  return value[key] || null;
}

async function writeBaseline(snapshot, reason) {
  const key = baselineStorageKey(snapshot.caseData.case_hash);
  await chrome.storage.local.set({
    [key]: {
      schema: 'aidp-observed-baseline/v1',
      observed_at: new Date().toISOString(),
      reason,
      case_key: snapshot.caseData.case_key,
      snapshot_id: snapshot.caseData.snapshot_id,
      source_fingerprint: snapshot.caseData.source_fingerprint,
      regions: snapshot.canonicalRegions
    }
  });
}

function diffCanonicalRegions(previousRegions, currentRegions) {
  const previousMap = new Map((previousRegions || []).map(region => [region.region_id, region]));
  const currentMap = new Map((currentRegions || []).map(region => [region.region_id, region]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, current] of currentMap) {
    const previous = previousMap.get(id);
    if (!previous) {
      added.push(current);
      continue;
    }
    const fields = [];
    for (const key of ['start', 'end', 'text', 'speaker', 'keep', 'voice_type', 'quality', 'round_id']) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
        fields.push({ field: key, before: previous[key], after: current[key] });
      }
    }
    if (fields.length) changed.push({ region_id: id, fields });
  }
  for (const [id, previous] of previousMap) {
    if (!currentMap.has(id)) removed.push(previous);
  }
  return { added, removed, changed };
}

async function attachPreviousSnapshotDiff(snapshot) {
  const baseline = await readBaseline(snapshot.caseData.case_hash);
  const diff = baseline
    ? diffCanonicalRegions(baseline.regions, snapshot.canonicalRegions)
    : { added: [], removed: [], changed: [] };
  const result = {
    schema: 'aidp-snapshot-diff/v1',
    generated_at: new Date().toISOString(),
    baseline_found: Boolean(baseline),
    baseline_observed_at: baseline?.observed_at || null,
    baseline_reason: baseline?.reason || null,
    baseline_snapshot_id: baseline?.snapshot_id || null,
    baseline_fingerprint: baseline?.source_fingerprint || null,
    current_snapshot_id: snapshot.caseData.snapshot_id,
    current_fingerprint: snapshot.caseData.source_fingerprint,
    changed: Boolean(diff.added.length || diff.removed.length || diff.changed.length),
    counts: {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length
    },
    ...diff
  };
  snapshot.summary.previous_snapshot_diff = result;
  return result;
}

function compareSnapshots(first, second) {
  const sameCase = first.caseData.case_key === second.caseData.case_key;
  const sameFingerprint = first.caseData.source_fingerprint === second.caseData.source_fingerprint;
  const sameCounts = JSON.stringify(first.summary.counts) === JSON.stringify(second.summary.counts) &&
    first.caseData.total_region_count === second.caseData.total_region_count;
  return {
    schema: 'aidp-export-guard/v1',
    generated_at: new Date().toISOString(),
    stable: sameCase && sameFingerprint && sameCounts,
    same_case: sameCase,
    same_fingerprint: sameFingerprint,
    same_counts: sameCounts,
    first: {
      generated_at: first.caseData.generated_at,
      case_key: first.caseData.case_key,
      snapshot_id: first.caseData.snapshot_id,
      source_fingerprint: first.caseData.source_fingerprint,
      total_region_count: first.caseData.total_region_count,
      counts: first.summary.counts
    },
    second: {
      generated_at: second.caseData.generated_at,
      case_key: second.caseData.case_key,
      snapshot_id: second.caseData.snapshot_id,
      source_fingerprint: second.caseData.source_fingerprint,
      total_region_count: second.caseData.total_region_count,
      counts: second.summary.counts
    }
  };
}

function applyMediaValidation(snapshot, mediaDiagnostics) {
  const decoded = Number(mediaDiagnostics?.decoded_duration);
  const platform = Number(snapshot.caseData.duration_sources.platform_wave_sec);
  const rangeItems = [];
  const warnings = [];
  if (Number.isFinite(decoded) && decoded > 0) {
    snapshot.caseData.duration_sources.decoded_media_sec = round6(decoded);
    snapshot.caseData.duration_sources.decoded_minus_platform_sec = Number.isFinite(platform)
      ? round6(decoded - platform)
      : null;
    for (const region of snapshot.regionsData.regions) {
      if (region.end > decoded + TIME_TOLERANCE.mediaRange) {
        const item = {
          region_id: region.region_id,
          end: region.end,
          decoded_duration: round6(decoded),
          exceed_sec: round6(region.end - decoded),
          keep: region.keep,
          voice_type: region.voice_type
        };
        rangeItems.push(item);
        warnings.push(`${item.region_id}: 終了${item.end.toFixed(3)}秒がデコード音声長${item.decoded_duration.toFixed(3)}秒を${item.exceed_sec.toFixed(3)}秒超過`);
      }
    }
  }
  const result = {
    schema: 'aidp-media-range-validation/v1',
    generated_at: new Date().toISOString(),
    decoded_media_available: Number.isFinite(decoded) && decoded > 0,
    platform_duration_sec: Number.isFinite(platform) ? round6(platform) : null,
    decoded_duration_sec: Number.isFinite(decoded) ? round6(decoded) : null,
    decoded_minus_platform_sec: Number.isFinite(decoded) && Number.isFinite(platform) ? round6(decoded - platform) : null,
    tolerance_sec: TIME_TOLERANCE.mediaRange,
    out_of_decoded_range: rangeItems,
    warnings
  };
  snapshot.caseData.validation_summary.media_warning_count = warnings.length;
  snapshot.summary.duration_sources = snapshot.caseData.duration_sources;
  snapshot.summary.media_range_validation = result;
  snapshot.capabilities.validation.media_range = result;
  return result;
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['BLOBS'],
    justification: 'AIDP元メディアをPC内でWAV・波形PNG・ZIPへ変換するため'
  });
}

async function prepareMedia(snapshot, options) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'AIDP_PREPARE_MEDIA',
    payload: {
      options: {
        includeAudio: options?.includeAudio !== false,
        includeWaveform: options?.includeWaveform !== false,
        allowJsonFallback: options?.allowJsonFallback !== false
      },
      mediaUrl: snapshot.mediaUrl,
      regions: snapshot.regionsData.regions,
      platformDuration: snapshot.caseData.duration_sources.platform_wave_sec
    }
  });
  if (!response?.ok) throw new Error(response?.error || '音声準備に失敗しました');
  return response.result;
}

async function cancelPreparedMedia(token) {
  if (!token) return;
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'AIDP_CANCEL_PREPARED_MEDIA', token });
  } catch (_) {}
}

async function buildPreparedZip(token, snapshot, diagnostics) {
  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'AIDP_BUILD_PREPARED_EXPORT_ZIP',
    payload: {
      token,
      caseData: snapshot.caseData,
      regionsData: snapshot.regionsData,
      capabilities: snapshot.capabilities,
      ruleset: snapshot.ruleset,
      snapshotDiff: diagnostics.snapshotDiff,
      exportGuard: diagnostics.exportGuard,
      mediaRangeValidation: diagnostics.mediaRangeValidation
    }
  });
  if (!response?.ok) throw new Error(response?.error || 'ZIP生成に失敗しました');
  return response.result;
}

async function runInspection() {
  const snapshot = await collectSnapshot();
  await attachPreviousSnapshotDiff(snapshot);
  await writeBaseline(snapshot, 'inspection');
  return snapshot;
}

async function exportZip(options) {
  await progress('書き出し前の第1snapshotを取得しています…', 4);
  const first = await collectSnapshot(5);
  const snapshotDiff = await attachPreviousSnapshotDiff(first);

  let prepared = null;
  try {
    await progress('元メディアを取得し、WAVと波形をPC内で準備しています…', 48);
    prepared = await prepareMedia(first, options);

    await progress('書き出し後の第2snapshotを再取得しています…', 66);
    const second = await collectSnapshot(65);
    const exportGuard = compareSnapshots(first, second);
    second.summary.export_guard = exportGuard;
    second.summary.previous_snapshot_diff = snapshotDiff;
    if (!exportGuard.stable) {
      await cancelPreparedMedia(prepared.token);
      prepared = null;
      throw new Error('書き出し処理中に案件fingerprintまたは件数が変化しました。ZIPは保存せず停止しました');
    }

    const mediaRangeValidation = applyMediaValidation(second, prepared.mediaDiagnostics);
    await progress('ruleset・差分・前後fingerprintを含むZIPを作成しています…', 84);
    const zipResult = await buildPreparedZip(prepared.token, second, {
      snapshotDiff,
      exportGuard,
      mediaRangeValidation
    });
    prepared = null;

    await progress('ZIPを保存しています…', 94);
    const downloadId = await chrome.downloads.download({
      url: zipResult.blobUrl,
      filename: zipResult.filename,
      saveAs: true
    });
    await writeBaseline(second, 'successful_export');
    const exportReport = {
      schema: 'aidp-export-report/v1',
      generated_at: new Date().toISOString(),
      bridge_version: VERSION,
      case_key: second.caseData.case_key,
      case_hash: second.caseData.case_hash,
      snapshot_id: second.caseData.snapshot_id,
      source_fingerprint: second.caseData.source_fingerprint,
      filename: zipResult.filename,
      download_id: downloadId,
      partial: zipResult.partial,
      zip_bytes: zipResult.zipBytes,
      file_count: zipResult.fileCount,
      export_guard: exportGuard,
      media_range_validation: mediaRangeValidation,
      validation_summary: second.caseData.validation_summary,
      submitted: false,
      staged: false
    };
    await saveLastReport('export', exportReport);
    return {
      ok: true,
      filename: zipResult.filename,
      downloadId,
      partial: zipResult.partial,
      summary: second.summary,
      report: exportReport
    };
  } catch (error) {
    if (prepared?.token) await cancelPreparedMedia(prepared.token);
    throw error;
  }
}


// ===== Integrated Beta: patch preview / apply / recovery =====
const PATCH_DRY_RUN_STORAGE_KEY = 'aidp_patch_dry_run_v2';
const LAST_REPORT_STORAGE_KEY = 'aidp_last_reports_v1';
const MUTATION_PORT_NAME = 'AIDP_MUTATION_JOB_V1';
const FEATURE_FLAGS = Object.freeze({
  update_region: true,
  set_labels: false,
  split_region: true,
  add_region: true,
  delete_region: true
});
let activeMutationJob = null;

function journalStorageKey(caseHash) {
  return `aidp_bridge_journal_${caseHash}`;
}

function isJournalFinal(status) {
  return ['confirmed', 'not_applied', 'rolled_back', 'rolled_back_after_failure', 'cancelled'].includes(String(status || ''));
}

async function readJournalByCaseHash(caseHash) {
  const key = journalStorageKey(caseHash);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

async function writeJournal(journal) {
  const key = journalStorageKey(journal.case_hash);
  journal.updated_at = new Date().toISOString();
  await chrome.storage.local.set({ [key]: journal });
  return journal;
}

async function saveLastReport(kind, report) {
  const stored = await chrome.storage.local.get(LAST_REPORT_STORAGE_KEY);
  const reports = stored[LAST_REPORT_STORAGE_KEY] || {};
  reports[kind] = report;
  await chrome.storage.local.set({ [LAST_REPORT_STORAGE_KEY]: reports });
}

async function mutationProgress(text, percent) {
  const payload = {
    type: 'AIDP_MUTATION_PROGRESS',
    job_id: activeMutationJob?.id || '',
    text,
    percent: Number.isFinite(Number(percent)) ? Number(percent) : null
  };
  if (activeMutationJob) {
    activeMutationJob.state = {
      ...activeMutationJob.state,
      status: 'running',
      text,
      percent: payload.percent,
      updated_at: new Date().toISOString()
    };
    try { activeMutationJob.port?.postMessage(payload); } catch (_) {}
  }
}

function performNeekoUpdateMainWorld(payload) {
  const round = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(9)) : null;
  const plain = region => {
    if (!region) return null;
    const out = {};
    for (const key of ['id', 'start', 'end', 'yuan_text', 'if_save', 'is_qualified', 'music', 'speaker_desc', 'round_id', 'color', 'drag', 'resize', 'loop']) {
      try {
        if (region[key] !== undefined) out[key] = ['start', 'end'].includes(key) ? round(region[key]) : region[key];
      } catch (_) {}
    }
    return out;
  };
  const findTarget = () => {
    const seeds = [...document.querySelectorAll('.neeko-wavesurfer,.neeko-wavesurfer-warper,wave,region.waver-region[data-id]')];
    const candidates = [];
    const seen = new Set();
    for (const seed of seeds) {
      let names = [];
      try { names = Object.getOwnPropertyNames(seed); } catch (_) {}
      const fiberKey = names.find(name => name.startsWith('__reactFiber$'));
      if (!fiberKey) continue;
      let fiber = seed[fiberKey];
      for (let depth = 0; fiber && depth < 50; depth += 1, fiber = fiber.return) {
        if (seen.has(fiber)) continue;
        seen.add(fiber);
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          if (!props || typeof props !== 'object') continue;
          for (const variant of [props, props.$api?.props].filter(Boolean)) {
            let regions = [];
            try {
              if (variant.regions && typeof variant.regions[Symbol.iterator] === 'function') regions = Array.from(variant.regions);
            } catch (_) {}
            const api = props.$api || variant.$api || null;
            const ref = api?.componentRef?.current || api?.$componentRef?.current || null;
            let score = 0;
            if (regions.length) score += 8;
            if (variant.regionsControlled === true) score += 5;
            if (typeof ref?.handleUpdateRegion === 'function') score += 12;
            if (typeof ref?.getWavesurferInstance === 'function') score += 4;
            if (/wavesurfer/i.test(String(api?.id || api?.$xpath || fiber.type?.displayName || fiber.elementType?.displayName || ''))) score += 7;
            if (score >= 12) candidates.push({ score, regions, ref, api, props: variant });
          }
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  };

  const target = findTarget();
  if (!target) return { ok: false, error: 'Neeko wavesurfer componentRefを検出できません' };
  if (typeof target.ref?.handleUpdateRegion !== 'function') return { ok: false, error: 'handleUpdateRegionがありません' };
  const current = target.regions.find(region => String(region?.id || '') === String(payload.region_id || ''));
  if (!current) return { ok: false, error: `regionが見つかりません: ${payload.region_id}` };

  const updated = {};
  try {
    for (const key of Object.keys(current)) updated[key] = current[key];
  } catch (_) {}
  for (const key of ['id', 'start', 'end', 'yuan_text', 'if_save', 'is_qualified', 'music', 'speaker_desc', 'round_id', 'color', 'drag', 'resize', 'loop']) {
    try { if (current[key] !== undefined) updated[key] = current[key]; } catch (_) {}
  }
  updated.id = current.id;
  const set = payload.set || {};
  if (set.start !== undefined) updated.start = Number(set.start);
  if (set.end !== undefined) updated.end = Number(set.end);
  if (set.speaker !== undefined) updated.speaker_desc = String(set.speaker);
  if (set.keep !== undefined) updated.if_save = String(set.keep);
  if (set.voice_type !== undefined) updated.music = String(set.voice_type);

  const before = plain(current);
  try {
    target.ref.handleUpdateRegion(String(current.id), updated);
  } catch (error) {
    return { ok: false, error: error?.message || String(error), before };
  }
  const afterCurrent = target.regions.find(region => String(region?.id || '') === String(payload.region_id || '')) || updated;
  return {
    ok: true,
    adapter: 'aidp-neeko-handleUpdateRegion-v1',
    before,
    requested: plain(updated),
    after: plain(afterCurrent)
  };
}

async function performNeekoUpdate(tabId, operation) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: performNeekoUpdateMainWorld,
    args: [{ region_id: operation.region_id, set: operation.set || {} }]
  });
  const value = result?.[0]?.result;
  if (!value?.ok) throw new Error(value?.error || `Neeko更新に失敗しました: ${operation.region_id}`);
  return value;
}


async function performNeekoStructureMainWorld(payload) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const round = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(9)) : null;
  const plain = region => {
    if (!region) return null;
    const out = {};
    for (const key of ['id', 'start', 'end', 'yuan_text', 'if_save', 'is_qualified', 'music', 'speaker_desc', 'round_id', 'color', 'drag', 'resize', 'loop']) {
      try {
        if (region[key] !== undefined) out[key] = ['start', 'end'].includes(key) ? round(region[key]) : region[key];
      } catch (_) {}
    }
    return out;
  };
  const findTarget = () => {
    const seeds = [...document.querySelectorAll('.neeko-wavesurfer,.neeko-wavesurfer-warper,wave,region.waver-region[data-id]')];
    const candidates = [];
    const seen = new Set();
    for (const seed of seeds) {
      let names = [];
      try { names = Object.getOwnPropertyNames(seed); } catch (_) {}
      const fiberKey = names.find(name => name.startsWith('__reactFiber$'));
      if (!fiberKey) continue;
      let fiber = seed[fiberKey];
      for (let depth = 0; fiber && depth < 60; depth += 1, fiber = fiber.return) {
        if (seen.has(fiber)) continue;
        seen.add(fiber);
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          if (!props || typeof props !== 'object') continue;
          for (const variant of [props, props.$api?.props].filter(Boolean)) {
            let regions = [];
            try {
              if (variant.regions && typeof variant.regions[Symbol.iterator] === 'function') regions = Array.from(variant.regions);
            } catch (_) {}
            const api = props.$api || variant.$api || null;
            const ref = api?.componentRef?.current || api?.$componentRef?.current || null;
            let score = 0;
            if (regions.length) score += 8;
            if (variant.regionsControlled === true) score += 5;
            if (typeof ref?.handleAddRegion === 'function') score += 10;
            if (typeof ref?.handleRemoveRegion === 'function') score += 10;
            if (typeof ref?.getWavesurferInstance === 'function') score += 4;
            if (/wavesurfer/i.test(String(api?.id || api?.$xpath || fiber.type?.displayName || fiber.elementType?.displayName || ''))) score += 7;
            if (score >= 16) candidates.push({ score, regions, ref, api, props: variant });
          }
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  };

  const target = findTarget();
  if (!target) return { ok: false, error: 'Neeko wavesurfer componentRefを検出できません' };
  const action = String(payload?.action || '');
  const regionInput = payload?.region || null;
  const regionId = String(regionInput?.region_id || regionInput?.id || payload?.region_id || '');
  if (!regionId) return { ok: false, error: '構造操作のregion IDがありません' };
  const beforeIds = target.regions.map(region => String(region?.id || ''));
  const beforeRegion = target.regions.find(region => String(region?.id || '') === regionId) || null;
  let requested = null;

  try {
    if (action === 'add') {
      if (typeof target.ref?.handleAddRegion !== 'function') return { ok: false, error: 'handleAddRegionがありません' };
      if (beforeRegion) return { ok: false, error: `追加予定IDが既に存在します: ${regionId}` };
      const nearest = [...target.regions]
        .sort((a, b) => Math.abs(Number(a?.start) - Number(regionInput?.start)) - Math.abs(Number(b?.start) - Number(regionInput?.start)))[0] || null;
      requested = {
        id: regionId,
        start: Number(regionInput.start),
        end: Number(regionInput.end),
        yuan_text: String(regionInput.text ?? regionInput.yuan_text ?? ''),
        if_save: String(regionInput.keep ?? regionInput.if_save ?? '保留'),
        is_qualified: String(regionInput.quality ?? regionInput.is_qualified ?? '无问题'),
        music: String(regionInput.voice_type ?? regionInput.music ?? '说话'),
        speaker_desc: String(regionInput.speaker ?? regionInput.speaker_desc ?? ''),
        round_id: Number.isFinite(Number(regionInput.round_id)) ? Number(regionInput.round_id) : undefined,
        drag: nearest?.drag ?? true,
        resize: nearest?.resize ?? true,
        loop: nearest?.loop ?? false
      };
      if (nearest?.color !== undefined) requested.color = nearest.color;
      target.ref.handleAddRegion(requested);
    } else if (action === 'remove') {
      if (typeof target.ref?.handleRemoveRegion !== 'function') return { ok: false, error: 'handleRemoveRegionがありません' };
      if (!beforeRegion) return { ok: false, error: `削除対象regionが見つかりません: ${regionId}` };
      target.ref.handleRemoveRegion(beforeRegion);
    } else {
      return { ok: false, error: `未対応構造操作: ${action}` };
    }
  } catch (error) {
    return { ok: false, error: error?.message || String(error), action, region_id: regionId, before: plain(beforeRegion), requested: plain(requested) };
  }

  let refreshed = target;
  let afterRegion = beforeRegion;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250);
    refreshed = findTarget() || refreshed;
    afterRegion = refreshed.regions.find(region => String(region?.id || '') === regionId) || null;
    if ((action === 'add' && afterRegion) || (action === 'remove' && !afterRegion)) break;
  }
  const afterIds = refreshed.regions.map(region => String(region?.id || ''));
  let wavePresent = null;
  try {
    const ws = refreshed.ref?.getWavesurferInstance?.();
    wavePresent = Boolean(ws?.regions?.list?.[regionId]);
  } catch (_) {}
  const localConfirmed = action === 'add' ? Boolean(afterRegion) : !afterRegion;
  return {
    // handleAddRegion / handleRemoveRegionが例外なく呼べた時点では、ここで失敗確定しない。
    // AIDPは構造変更後のReact props / Wave / Table反映が遅れることがあるため、
    // 正否は後段の一時保存Payload全件一致とwaitForExpectedRegionStateで確定する。
    ok: true,
    error: null,
    adapter: 'aidp-neeko-structural-adapter-v2-deferred-verification',
    action,
    region_id: regionId,
    invoked: true,
    local_confirmation: localConfirmed ? 'confirmed' : 'pending',
    local_warning: localConfirmed ? null : `${action === 'add' ? '追加' : '削除'}の即時Model確認は未確定。保存Payloadと全件settlementで継続確認します`,
    before_count: beforeIds.length,
    after_count: afterIds.length,
    before_ids: beforeIds,
    after_ids: afterIds,
    before: plain(beforeRegion),
    requested: plain(requested),
    after: plain(afterRegion),
    wave_present: wavePresent
  };
}

async function performNeekoStructure(tabId, action, region) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: performNeekoStructureMainWorld,
    args: [{ action, region }]
  });
  const value = result?.[0]?.result;
  if (!value?.ok) throw new Error(value?.error || `Neeko構造操作に失敗しました: ${action}`);
  return value;
}

async function performReactTextUpdateMainWorld(payload) {
  const normalize = value => String(value ?? '').replace(/\r\n/g, '\n');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const regionId = String(payload?.region_id || '');
  const requested = normalize(payload?.text ?? '');
  const expected = payload?.expected_text == null ? null : normalize(payload.expected_text);

  const rowId = row => {
    for (const element of [row, ...row.querySelectorAll('[class]')]) {
      const className = [...(element.classList || [])].find(name => /^region-region_/.test(name));
      if (className) return className.slice('region-'.length);
    }
    return '';
  };
  const row = [...document.querySelectorAll('tbody > tr.arco-table-tr')]
    .find(item => rowId(item) === regionId);
  const textarea = row?.querySelector('textarea.neeko-input-textarea');
  if (!textarea) return { ok: false, error: `${regionId}: 字幕textareaが見つかりません` };

  const before = normalize(textarea.value);
  if (before !== requested && expected !== null && before !== expected) {
    return { ok: false, error: `${regionId}: 字幕の現在値がexpectedと一致しません（actual=${JSON.stringify(before)}）`, before };
  }

  const fiberOf = element => {
    let keys = [];
    try { keys = Object.getOwnPropertyNames(element || {}); } catch (_) {}
    const key = keys.find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
    return key ? element[key] : null;
  };
  const findStore = () => {
    const wrapper = document.querySelector('[data-component-rum-id="neeko-wavesurfer"]') || document.querySelector('.neeko-wavesurfer');
    const seeds = [textarea, wrapper].filter(Boolean);
    const seen = new Set();
    for (const seed of seeds) {
      let fiber = fiberOf(seed);
      for (let depth = 0; fiber && depth < 130; depth += 1, fiber = fiber.return) {
        if (seen.has(fiber)) continue;
        seen.add(fiber);
        for (const root of [fiber.memoizedProps, fiber.pendingProps, fiber.memoizedState]) {
          if (!root || typeof root !== 'object') continue;
          let values = [];
          try { values = [root.store, ...Object.values(root).slice(0, 160)]; } catch (_) { values = [root.store]; }
          for (const candidate of values) {
            if (!candidate || typeof candidate !== 'object') continue;
            const dataRegions = candidate?.newResult?.data?.regions;
            const dataMapRegions = candidate?.newResult?.dataMap?.regions;
            if (typeof candidate.onDataChange === 'function' && Array.isArray(dataRegions) && Array.isArray(dataMapRegions)) {
              return candidate;
            }
          }
        }
      }
    }
    return null;
  };
  const targetFrom = regions => Array.isArray(regions)
    ? regions.find(region => String(region?.id || region?.region_id || '') === regionId)
    : null;
  const textOf = region => normalize(region?.yuan_text ?? region?.text ?? region?.source_text ?? region?.transcript ?? '');

  if (before !== requested) {
    let propKeys = [];
    try { propKeys = Object.getOwnPropertyNames(textarea); } catch (_) {}
    const propsKey = propKeys.find(name => name.startsWith('__reactProps$'));
    const props = propsKey ? textarea[propsKey] : null;
    if (typeof props?.onChange !== 'function') {
      return { ok: false, error: `${regionId}: textareaの正式なReact onChangeを取得できません` };
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (typeof setter !== 'function') return { ok: false, error: '字幕textareaのvalue setterを取得できません' };
    setter.call(textarea, requested);
    const eventLike = {
      type: 'change',
      target: textarea,
      currentTarget: textarea,
      nativeEvent: {},
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      persist() {},
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      isDefaultPrevented() { return this.defaultPrevented; },
      isPropagationStopped() { return false; }
    };
    try { props.onChange(eventLike); }
    catch (error) { return { ok: false, error: `${regionId}: React onChange実行失敗: ${error?.message || String(error)}` };
    }
  }

  const deadline = Date.now() + 7000;
  let stable = 0;
  let lastSignature = '';
  let last = null;
  while (Date.now() < deadline) {
    const store = findStore();
    const dataRegions = store?.newResult?.data?.regions;
    const dataMapRegions = store?.newResult?.dataMap?.regions;
    const dataTarget = targetFrom(dataRegions);
    const dataMapTarget = targetFrom(dataMapRegions);
    const actual = normalize(textarea.value);
    const signature = JSON.stringify([
      actual,
      textOf(dataTarget),
      textOf(dataMapTarget),
      Array.isArray(dataRegions) ? dataRegions.length : null,
      Array.isArray(dataMapRegions) ? dataMapRegions.length : null
    ]);
    const matched = actual === requested && textOf(dataTarget) === requested && textOf(dataMapTarget) === requested;
    stable = matched && signature === lastSignature ? stable + 1 : (matched ? 1 : 0);
    lastSignature = signature;
    last = {
      textarea_text: actual,
      data_text: textOf(dataTarget),
      dataMap_text: textOf(dataMapTarget),
      data_count: Array.isArray(dataRegions) ? dataRegions.length : null,
      dataMap_count: Array.isArray(dataMapRegions) ? dataMapRegions.length : null
    };
    if (stable >= 2) {
      return {
        ok: true,
        adapter: 'aidp-react-textarea-onchange-v3',
        region_id: regionId,
        before,
        requested,
        after: actual,
        already_applied: before === requested,
        model: last
      };
    }
    await sleep(150);
  }
  return { ok: false, error: `${regionId}: React onChange後にtextarea/data/dataMapが一致しません`, detail: last };
}

function installTempSaveTraceMainWorld(traceId) {
  const KEY = '__AIDP_BRIDGE_TEMP_SAVE_TRACE_V1__';
  const previous = window[KEY];
  try {
    if (previous?.active) {
      XMLHttpRequest.prototype.open = previous.originalOpen;
      XMLHttpRequest.prototype.send = previous.originalSend;
    }
  } catch (_) {}

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const metadata = new WeakMap();
  const records = [];

  XMLHttpRequest.prototype.open = function(method, url) {
    metadata.set(this, { method: String(method || 'GET').toUpperCase(), url: String(url || '') });
    return Reflect.apply(originalOpen, this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const meta = metadata.get(this) || {};
    if (!meta.url.includes('/api/dispatch/SubmitTempItemAnswer')) {
      return Reflect.apply(originalSend, this, arguments);
    }
    let content = null;
    let parseError = '';
    try {
      const outer = typeof body === 'string' ? JSON.parse(body) : null;
      content = JSON.parse(outer?.AuditAnswers?.[0]?.Content || '{}');
    } catch (error) {
      parseError = error?.message || String(error);
    }
    const record = {
      requested_at: new Date().toISOString(),
      requested_ms: Date.now(),
      method: meta.method,
      url: meta.url,
      body_length: typeof body === 'string' ? body.length : null,
      content,
      parse_error: parseError,
      status: null,
      completed_at: null,
      duration_ms: null
    };
    records.push(record);
    const started = performance.now();
    this.addEventListener('loadend', () => {
      record.status = Number(this.status || 0);
      record.completed_at = new Date().toISOString();
      record.duration_ms = Number((performance.now() - started).toFixed(3));
    }, { once: true });
    return Reflect.apply(originalSend, this, arguments);
  };

  window[KEY] = { active: true, traceId: String(traceId), records, originalOpen, originalSend };
  return { ok: true, trace_id: String(traceId) };
}

function readTempSaveTraceMainWorld(traceId, expected) {
  const KEY = '__AIDP_BRIDGE_TEMP_SAVE_TRACE_V1__';
  const trace = window[KEY];
  if (!trace?.active || String(trace.traceId) !== String(traceId)) {
    return { ok: false, error: '一時保存traceが見つかりません', records: [] };
  }
  const normalize = value => String(value ?? '').replace(/\r\n/g, '\n');
  const round6 = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
  const close = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 0.0000015;
  const idOf = region => String(region?.id || region?.region_id || '');
  const textOf = region => normalize(region?.yuan_text ?? region?.text ?? region?.source_text ?? region?.transcript ?? '');
  const canonical = region => ({
    region_id: idOf(region),
    start: round6(region?.start),
    end: round6(region?.end),
    text: textOf(region),
    speaker: String(region?.speaker_desc ?? region?.speaker ?? ''),
    keep: String(region?.if_save ?? region?.keep ?? ''),
    voice_type: String(region?.music ?? region?.voice_type ?? ''),
    quality: String(region?.is_qualified ?? region?.quality ?? ''),
    round_id: Number.isFinite(Number(region?.round_id)) ? Number(region.round_id) : null
  });
  const canonicalList = regions => (Array.isArray(regions) ? regions.map(canonical) : [])
    .sort((a, b) => (a.round_id ?? Number.MAX_SAFE_INTEGER) - (b.round_id ?? Number.MAX_SAFE_INTEGER) || a.start - b.start || a.region_id.localeCompare(b.region_id));
  const expectedList = Array.isArray(expected?.expected_regions)
    ? expected.expected_regions.map(canonical).sort((a, b) => (a.round_id ?? Number.MAX_SAFE_INTEGER) - (b.round_id ?? Number.MAX_SAFE_INTEGER) || a.start - b.start || a.region_id.localeCompare(b.region_id))
    : null;
  const summarize = (record, index) => {
    const data = record.content?.data?.regions;
    const dataMap = record.content?.dataMap?.regions;
    const ids = Array.isArray(data) ? data.map(idOf) : [];
    const idsMap = Array.isArray(dataMap) ? dataMap.map(idOf) : [];
    const idsOk = JSON.stringify(ids) === JSON.stringify(idsMap);
    const dataCanonical = canonicalList(data);
    const dataMapCanonical = canonicalList(dataMap);
    let targetData = null;
    let targetDataMap = null;
    let targetOk = false;
    let fullStateOk = false;
    if (expectedList) {
      fullStateOk = JSON.stringify(dataCanonical) === JSON.stringify(expectedList) &&
        JSON.stringify(dataMapCanonical) === JSON.stringify(expectedList);
    } else {
      targetData = Array.isArray(data) ? data.find(region => idOf(region) === String(expected?.region_id || '')) : null;
      targetDataMap = Array.isArray(dataMap) ? dataMap.find(region => idOf(region) === String(expected?.region_id || '')) : null;
      targetOk = Boolean(targetData && targetDataMap) &&
        textOf(targetData) === normalize(expected?.text) && textOf(targetDataMap) === normalize(expected?.text) &&
        close(targetData.start, expected?.start) && close(targetData.end, expected?.end) &&
        close(targetDataMap.start, expected?.start) && close(targetDataMap.end, expected?.end);
    }
    const expectedCount = Number(expected?.expected_count);
    const countsOk = Array.isArray(data) && Array.isArray(dataMap) && data.length === dataMap.length &&
      (!Number.isFinite(expectedCount) || (data.length === expectedCount && dataMap.length === expectedCount));
    const matched = record.status === 200 && !record.parse_error && countsOk && idsOk && (expectedList ? fullStateOk : targetOk);
    return {
      index,
      requested_at: record.requested_at,
      requested_ms: record.requested_ms,
      method: record.method,
      url: record.url,
      body_length: record.body_length,
      status: record.status,
      completed_at: record.completed_at,
      duration_ms: record.duration_ms,
      parse_error: record.parse_error || null,
      data_count: Array.isArray(data) ? data.length : null,
      dataMap_count: Array.isArray(dataMap) ? dataMap.length : null,
      ids_match: idsOk,
      full_state_match: expectedList ? fullStateOk : null,
      target: expectedList ? null : {
        data: targetData ? { text: textOf(targetData), start: targetData.start, end: targetData.end } : null,
        dataMap: targetDataMap ? { text: textOf(targetDataMap), start: targetDataMap.start, end: targetDataMap.end } : null
      },
      matched
    };
  };
  const records = trace.records.map(summarize);
  return {
    ok: true,
    trace_id: String(traceId),
    matched: records.some(record => record.matched),
    last_requested_ms: records.length ? records[records.length - 1].requested_ms : null,
    records
  };
}

function removeTempSaveTraceMainWorld(traceId) {
  const KEY = '__AIDP_BRIDGE_TEMP_SAVE_TRACE_V1__';
  const trace = window[KEY];
  if (!trace?.active || String(trace.traceId) !== String(traceId)) return { ok: true, removed: false };
  XMLHttpRequest.prototype.open = trace.originalOpen;
  XMLHttpRequest.prototype.send = trace.originalSend;
  trace.active = false;
  return { ok: true, removed: true };
}

async function installTempSaveTrace(tabId, traceId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: installTempSaveTraceMainWorld,
    args: [traceId]
  });
  const value = result?.[0]?.result;
  if (!value?.ok) throw new Error(value?.error || '一時保存traceを開始できません');
  return value;
}

async function removeTempSaveTrace(tabId, traceId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: removeTempSaveTraceMainWorld,
      args: [traceId]
    });
  } catch (_) {}
}

async function waitForTempSavePayload(tabId, traceId, expected, timeoutMs = 30000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt <= timeoutMs) {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readTempSaveTraceMainWorld,
      args: [traceId, expected]
    });
    last = result?.[0]?.result || null;
    const quiet = last?.last_requested_ms && Date.now() - Number(last.last_requested_ms) >= 2500;
    if (last?.matched && quiet) {
      return {
        ok: true,
        trace_id: traceId,
        elapsed_ms: Date.now() - startedAt,
        quiet_period_ms: 2500,
        records: last.records || []
      };
    }
    await sleep(250);
  }
  const error = new Error(`一時保存PayloadのHTTP 200とdata/dataMap一致を確認できませんでした（${Math.round(timeoutMs / 1000)}秒）`);
  error.code = 'AIDP_TEMP_SAVE_UNCONFIRMED';
  error.trace = last;
  throw error;
}

async function performTextUpdate(tabId, operation) {
  const set = operation?.set || {};
  if (set.text === undefined) return null;
  const prepared = await chrome.tabs.sendMessage(tabId, {
    type: 'AIDP_PREPARE_REGION_TEXT',
    payload: {
      region_id: operation.region_id,
      text: String(set.text),
      expected_text: operation?.before?.text,
      page: operation?.before?.table?.page || operation?.after?.table?.page || null
    }
  });
  if (!prepared?.ok) throw new Error(prepared?.error || `${operation.region_id}: 字幕行の準備に失敗しました`);
  const originalPage = prepared.result?.original_page;
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: performReactTextUpdateMainWorld,
      args: [{
        region_id: operation.region_id,
        text: String(set.text),
        expected_text: operation?.before?.text
      }]
    });
    const value = result?.[0]?.result;
    if (!value?.ok) throw new Error(value?.error || `${operation.region_id}: React字幕入力に失敗しました`);
    return { ...value, page: prepared.result?.page, original_page: originalPage };
  } finally {
    if (Number.isFinite(Number(originalPage)) && Number(originalPage) >= 1) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'AIDP_RESTORE_TABLE_PAGE',
          payload: { page: Number(originalPage) }
        });
      } catch (_) {}
    }
  }
}

async function performRegionUpdate(tabId, operation) {
  const set = operation?.set || {};
  const neekoSet = {};
  if (set.start !== undefined) neekoSet.start = set.start;
  if (set.end !== undefined) neekoSet.end = set.end;

  const hasNeekoUpdate = Object.keys(neekoSet).length > 0;
  const hasText = set.text !== undefined;
  const hasMutation = hasNeekoUpdate || hasText;
  const traceId = `save-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const result = {
    ok: true,
    adapter: 'aidp-react-text-and-neeko-time-adapter-v3',
    region_id: operation.region_id,
    neeko: null,
    text: null,
    save: null,
    compensated: false
  };

  if (!hasMutation) return result;
  await installTempSaveTrace(tabId, traceId);
  let textApplied = false;
  let neekoApplied = false;
  try {
    if (hasText) {
      result.text = await performTextUpdate(tabId, operation);
      textApplied = !result.text?.already_applied;
    }
    if (hasNeekoUpdate) {
      result.neeko = await performNeekoUpdate(tabId, {
        region_id: operation.region_id,
        set: neekoSet
      });
      neekoApplied = true;
    }

    const expected = operation?.after || {
      region_id: operation.region_id,
      text: set.text ?? operation?.before?.text,
      start: set.start ?? operation?.before?.start,
      end: set.end ?? operation?.before?.end
    };
    result.save = await waitForTempSavePayload(tabId, traceId, {
      region_id: operation.region_id,
      text: expected.text,
      start: expected.start,
      end: expected.end,
      expected_count: operation?.expected_region_count
    });
    return result;
  } catch (error) {
    if (error?.code !== 'AIDP_TEMP_SAVE_UNCONFIRMED' && operation?.before) {
      const compensationErrors = [];
      if (neekoApplied) {
        try {
          const restoreSet = {};
          if (set.start !== undefined) restoreSet.start = operation.before.start;
          if (set.end !== undefined) restoreSet.end = operation.before.end;
          if (Object.keys(restoreSet).length) {
            await performNeekoUpdate(tabId, { region_id: operation.region_id, set: restoreSet });
          }
        } catch (compensationError) {
          compensationErrors.push(`時刻補償失敗: ${compensationError?.message || String(compensationError)}`);
        }
      }
      if (textApplied) {
        try {
          await performTextUpdate(tabId, {
            region_id: operation.region_id,
            set: { text: operation.before.text },
            before: { ...operation.after, text: set.text },
            after: operation.before
          });
        } catch (compensationError) {
          compensationErrors.push(`字幕補償失敗: ${compensationError?.message || String(compensationError)}`);
        }
      }
      result.compensated = compensationErrors.length === 0 && (neekoApplied || textApplied);
      if (compensationErrors.length) {
        const wrapped = new Error(`${error?.message || String(error)} / ${compensationErrors.join(' / ')}`);
        wrapped.adapter_result = result;
        throw wrapped;
      }
    }
    const wrapped = new Error(error?.message || String(error));
    wrapped.code = error?.code;
    wrapped.trace = error?.trace;
    wrapped.adapter_result = result;
    throw wrapped;
  } finally {
    await removeTempSaveTrace(tabId, traceId);
  }
}

async function performStructuralAdd(tabId, operation) {
  const region = operation?.after;
  if (!region?.region_id) throw new Error('add_regionの生成済みregion IDがありません');
  const traceId = `save-struct-add-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const result = {
    ok: true,
    adapter: 'aidp-structural-add-v1',
    region_id: region.region_id,
    neeko: null,
    save: null,
    compensated: false
  };
  await installTempSaveTrace(tabId, traceId);
  let added = false;
  try {
    result.neeko = await performNeekoStructure(tabId, 'add', region);
    added = true;
    result.save = await waitForTempSavePayload(tabId, traceId, {
      expected_regions: operation.expected_regions_after,
      expected_count: operation.expected_regions_after?.length
    });
    return result;
  } catch (error) {
    const compensationErrors = [];
    if (added) {
      try { await performNeekoStructure(tabId, 'remove', region); }
      catch (compensationError) { compensationErrors.push(`追加補償削除失敗: ${compensationError?.message || String(compensationError)}`); }
    }
    result.compensated = added && compensationErrors.length === 0;
    const wrapped = new Error([error?.message || String(error), ...compensationErrors].join(' / '));
    wrapped.code = error?.code;
    wrapped.trace = error?.trace;
    wrapped.adapter_result = result;
    throw wrapped;
  } finally {
    await removeTempSaveTrace(tabId, traceId);
  }
}

async function performStructuralDelete(tabId, operation) {
  const region = operation?.before;
  if (!region?.region_id) throw new Error('delete_regionの対象region IDがありません');
  const traceId = `save-struct-delete-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const result = {
    ok: true,
    adapter: 'aidp-structural-delete-v1',
    region_id: region.region_id,
    neeko: null,
    save: null,
    compensated: false
  };
  await installTempSaveTrace(tabId, traceId);
  let removed = false;
  try {
    result.neeko = await performNeekoStructure(tabId, 'remove', region);
    removed = true;
    result.save = await waitForTempSavePayload(tabId, traceId, {
      expected_regions: operation.expected_regions_after,
      expected_count: operation.expected_regions_after?.length
    });
    return result;
  } catch (error) {
    const compensationErrors = [];
    if (removed) {
      try { await performNeekoStructure(tabId, 'add', region); }
      catch (compensationError) { compensationErrors.push(`削除補償追加失敗: ${compensationError?.message || String(compensationError)}`); }
    }
    result.compensated = removed && compensationErrors.length === 0;
    const wrapped = new Error([error?.message || String(error), ...compensationErrors].join(' / '));
    wrapped.code = error?.code;
    wrapped.trace = error?.trace;
    wrapped.adapter_result = result;
    throw wrapped;
  } finally {
    await removeTempSaveTrace(tabId, traceId);
  }
}

async function performStructuralSplit(tabId, operation) {
  const parts = Array.isArray(operation?.after) ? operation.after : [];
  if (parts.length !== 2) throw new Error('split_regionの確定partが2件ではありません');
  const [first, second] = parts;
  const result = {
    ok: true,
    adapter: 'aidp-structural-split-v1',
    region_id: operation.region_id,
    added_region_id: second.region_id,
    add: null,
    update_first: null,
    compensated: false
  };
  let secondAdded = false;
  let firstUpdated = false;
  try {
    const traceId = `save-split-add-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    await installTempSaveTrace(tabId, traceId);
    try {
      result.add = await performNeekoStructure(tabId, 'add', second);
      secondAdded = true;
      result.add_save = await waitForTempSavePayload(tabId, traceId, {
        region_id: second.region_id,
        text: second.text,
        start: second.start,
        end: second.end,
        expected_count: operation.expected_regions_after?.length
      });
    } finally {
      await removeTempSaveTrace(tabId, traceId);
    }

    const set = {};
    for (const field of ['start', 'end', 'text']) {
      if (JSON.stringify(first[field]) !== JSON.stringify(operation.before?.[field])) set[field] = first[field];
    }
    result.update_first = await performRegionUpdate(tabId, {
      region_id: first.region_id,
      set,
      before: operation.before,
      after: first,
      expected_region_count: operation.expected_regions_after?.length
    });
    firstUpdated = true;
    return result;
  } catch (error) {
    const compensationErrors = [];
    if (secondAdded || firstUpdated) {
      try {
        await performRegionUpdate(tabId, {
          region_id: operation.before.region_id,
          set: operationSetFromCanonical(operation.before, ['start', 'end', 'text']),
          before: first,
          after: operation.before,
          expected_region_count: operation.expected_regions_after?.length
        });
      } catch (compensationError) {
        compensationErrors.push(`分割元region復元失敗: ${compensationError?.message || String(compensationError)}`);
      }
    }
    if (secondAdded) {
      try { await performNeekoStructure(tabId, 'remove', second); }
      catch (compensationError) { compensationErrors.push(`分割追加region削除失敗: ${compensationError?.message || String(compensationError)}`); }
    }
    result.compensated = (firstUpdated || secondAdded) && compensationErrors.length === 0;
    const wrapped = new Error([error?.message || String(error), ...compensationErrors].join(' / '));
    wrapped.code = error?.code;
    wrapped.trace = error?.trace;
    wrapped.adapter_result = result;
    throw wrapped;
  }
}

async function performPatchOperation(tabId, operation) {
  if (operation.type === 'update_region' || operation.type === 'set_labels') {
    return performRegionUpdate(tabId, operation);
  }
  if (operation.type === 'add_region') return performStructuralAdd(tabId, operation);
  if (operation.type === 'delete_region') return performStructuralDelete(tabId, operation);
  if (operation.type === 'split_region') return performStructuralSplit(tabId, operation);
  throw new Error(`未対応operation: ${operation.type}`);
}


function canonicalRegionEquals(a, b) {
  if (!a || !b) return false;
  if (!numericClose(a.start, b.start, TIME_TOLERANCE.tableVsModel)) return false;
  if (!numericClose(a.end, b.end, TIME_TOLERANCE.tableVsModel)) return false;
  for (const key of ['text', 'speaker', 'keep', 'voice_type', 'quality']) {
    const av = key === 'text' ? normalizeText(a[key]) : String(a[key] ?? '');
    const bv = key === 'text' ? normalizeText(b[key]) : String(b[key] ?? '');
    if (av !== bv) return false;
  }
  return JSON.stringify(a.round_id ?? null) === JSON.stringify(b.round_id ?? null);
}

function normalizedCanonicalRegions(regions) {
  return (Array.isArray(regions) ? regions : []).map(canonicalRegion)
    .sort((a, b) => (a.round_id ?? Number.MAX_SAFE_INTEGER) - (b.round_id ?? Number.MAX_SAFE_INTEGER) || a.start - b.start || a.region_id.localeCompare(b.region_id));
}

function canonicalRegionListsEqual(a, b) {
  return JSON.stringify(normalizedCanonicalRegions(a)) === JSON.stringify(normalizedCanonicalRegions(b));
}

async function waitForExpectedRegionState(expectedRegions, progressBase = 35, timeoutMs = APPLY_SETTLEMENT.timeoutMs) {
  const expected = normalizedCanonicalRegions(expectedRegions);
  const startedAt = Date.now();
  const attempts = [];
  let stableMatches = 0;
  let lastSnapshot = null;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const snapshot = await collectSnapshot(progressBase);
      lastSnapshot = snapshot;
      const exact = canonicalRegionListsEqual(snapshot.canonicalRegions, expected);
      const tripleMatch = Boolean(snapshot.summary.validation?.triple_match);
      const ok = exact && tripleMatch;
      stableMatches = ok ? stableMatches + 1 : 0;
      attempts.push({
        attempt: attempts.length + 1,
        elapsed_ms: Date.now() - startedAt,
        ok,
        exact_full_state: exact,
        triple_match: tripleMatch,
        actual_count: snapshot.canonicalRegions.length,
        expected_count: expected.length,
        fingerprint: snapshot.caseData.source_fingerprint,
        errors: snapshot.summary.validation?.errors || []
      });
      if (stableMatches >= 2) {
        return { ok: true, snapshot, attempts, elapsed_ms: Date.now() - startedAt };
      }
    } catch (error) {
      stableMatches = 0;
      attempts.push({
        attempt: attempts.length + 1,
        elapsed_ms: Date.now() - startedAt,
        ok: false,
        error: error?.message || String(error)
      });
    }
    await sleep(APPLY_SETTLEMENT.pollIntervalMs);
  }
  return { ok: false, snapshot: lastSnapshot, attempts, elapsed_ms: Date.now() - startedAt };
}

function verifyOnlyTargetChanged(before, after, targetId, expectedTarget) {
  const beforeMap = new Map(before.canonicalRegions.map(region => [region.region_id, region]));
  const afterMap = new Map(after.canonicalRegions.map(region => [region.region_id, region]));
  const errors = [];
  if (!sameSet(new Set(beforeMap.keys()), new Set(afterMap.keys()))) errors.push('region ID集合が変更されました');
  for (const [id, previous] of beforeMap) {
    const current = afterMap.get(id);
    if (!current) continue;
    if (id === targetId) {
      if (!canonicalRegionEquals(current, expectedTarget)) errors.push(`${id}: 変更後値がdry-run予定値と一致しません`);
    } else if (!canonicalRegionEquals(previous, current)) {
      errors.push(`${id}: 対象外regionが変化しました`);
    }
  }
  if (!after.summary.validation?.triple_match) errors.push('適用後のModel/Wave/Table三重照合が不一致です');
  return { ok: errors.length === 0, errors };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function compactCanonicalRegion(region) {
  if (!region) return null;
  return {
    region_id: region.region_id,
    start: region.start,
    end: region.end,
    text: region.text,
    speaker: region.speaker,
    keep: region.keep,
    voice_type: region.voice_type,
    quality: region.quality,
    round_id: region.round_id
  };
}

async function waitForOperationSettlement(beforeSnapshot, targetId, expectedTarget, progressBase = 35) {
  const startedAt = Date.now();
  const attempts = [];
  let lastSnapshot = null;
  let lastVerify = { ok: false, errors: ['反映確認を開始していません'] };
  await sleep(APPLY_SETTLEMENT.initialDelayMs);

  while (Date.now() - startedAt <= APPLY_SETTLEMENT.timeoutMs) {
    const attempt = attempts.length + 1;
    try {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(88, progressBase + Math.round((elapsed / APPLY_SETTLEMENT.timeoutMs) * 35));
      const snapshot = await collectSnapshot(progress);
      const verify = verifyOnlyTargetChanged(beforeSnapshot, snapshot, targetId, expectedTarget);
      const actualTarget = snapshot.canonicalRegions.find(region => region.region_id === targetId) || null;
      attempts.push({
        attempt,
        elapsed_ms: Date.now() - startedAt,
        ok: verify.ok,
        errors: [...verify.errors],
        fingerprint: snapshot.caseData.source_fingerprint,
        triple_match: Boolean(snapshot.summary.validation?.triple_match),
        actual_target: compactCanonicalRegion(actualTarget),
        validation_errors: [...(snapshot.summary.validation?.errors || [])]
      });
      lastSnapshot = snapshot;
      lastVerify = verify;
      if (verify.ok) {
        return { ok: true, elapsed_ms: Date.now() - startedAt, attempts, snapshot, verify };
      }
    } catch (error) {
      attempts.push({
        attempt,
        elapsed_ms: Date.now() - startedAt,
        ok: false,
        errors: [error?.message || String(error)],
        snapshot_error: true
      });
      lastVerify = { ok: false, errors: [error?.message || String(error)] };
    }
    await sleep(APPLY_SETTLEMENT.pollIntervalMs);
  }

  return { ok: false, elapsed_ms: Date.now() - startedAt, attempts, snapshot: lastSnapshot, verify: lastVerify };
}

async function waitForFingerprint(expectedFingerprint, timeoutMs = ROLLBACK_SETTLEMENT.timeoutMs) {
  const startedAt = Date.now();
  const attempts = [];
  let stableMatches = 0;
  let lastSnapshot = null;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const snapshot = await collectSnapshot(82);
      const matched = snapshot.caseData.source_fingerprint === expectedFingerprint;
      stableMatches = matched ? stableMatches + 1 : 0;
      attempts.push({
        attempt: attempts.length + 1,
        elapsed_ms: Date.now() - startedAt,
        fingerprint: snapshot.caseData.source_fingerprint,
        matched,
        triple_match: Boolean(snapshot.summary.validation?.triple_match)
      });
      lastSnapshot = snapshot;
      if (matched && stableMatches >= ROLLBACK_SETTLEMENT.stableMatchesRequired) {
        return { ok: true, snapshot, attempts, elapsed_ms: Date.now() - startedAt };
      }
    } catch (error) {
      attempts.push({ attempt: attempts.length + 1, elapsed_ms: Date.now() - startedAt, error: error?.message || String(error) });
      stableMatches = 0;
    }
    await sleep(ROLLBACK_SETTLEMENT.pollIntervalMs);
  }
  return { ok: false, snapshot: lastSnapshot, attempts, elapsed_ms: Date.now() - startedAt };
}

function structuralOperationIdsFromPatch(patchInput) {
  const patch = typeof patchInput === 'string' ? JSON.parse(patchInput) : patchInput;
  const operations = Array.isArray(patch?.operations) ? patch.operations : [];
  return [...new Set(operations
    .filter(operation => ['split_region', 'add_region', 'delete_region'].includes(String(operation?.type || '')))
    .map(operation => String(operation?.op_id || ''))
    .filter(Boolean))].sort();
}

async function runPatchDryRun(patchInput, approvedStructuralOpIds = null) {
  if (activeExportJob || activeMutationJob) throw new Error('別の書き出し・変更処理が進行中です');
  const snapshot = await collectSnapshot();
  const approvals = approvedStructuralOpIds == null
    ? structuralOperationIdsFromPatch(patchInput)
    : [...new Set((approvedStructuralOpIds || []).map(String))].sort();
  const report = globalThis.AIDPPatchEngine.dryRun(patchInput, snapshot, {
    featureFlags: FEATURE_FLAGS,
    approvedStructuralOpIds: approvals
  });
  if (!snapshot.summary.validation?.triple_match) {
    report.errors.unshift('現在案件のModel/Wave/Table三重照合が不一致のため、書き込みできません');
    report.applicable = false;
  }
  const patchHash = `sha256:${await sha256Text(report.patch_stable_json)}`;
  const expectedFingerprint = `sha256:${await sha256Text(JSON.stringify(report.simulated_fingerprint_payload))}`;
  const approvalKey = approvals.join(',');
  const token = `sha256:${await sha256Text(`${snapshot.caseData.case_key}\n${snapshot.caseData.source_fingerprint}\n${patchHash}\n${approvalKey}\n${report.generated_at}`)}`;
  report.patch_hash = patchHash;
  report.expected_result_fingerprint = expectedFingerprint;
  report.dry_run_token = token;
  report.feature_flags = cloneJson(FEATURE_FLAGS);
  report.approved_structural_op_ids = approvals;
  report.confirmation_mode = 'single_apply_click_after_dry_run';
  const stored = {
    schema: 'aidp-stored-dry-run/v1',
    stored_at: new Date().toISOString(),
    token,
    patch_hash: patchHash,
    expected_result_fingerprint: expectedFingerprint,
    report
  };
  await chrome.storage.session.set({ [PATCH_DRY_RUN_STORAGE_KEY]: stored });
  await saveLastReport('dry_run', report);
  return report;
}

async function approveStructuralDryRun(token, requestedOpIds) {
  const stored = await loadDryRun(token);
  const prior = stored.report;
  const requested = [...new Set((requestedOpIds || []).map(String))].sort();
  const structural = prior.operations
    .filter(item => ['split_region', 'add_region', 'delete_region'].includes(item.type) && item.errors.length === 0)
    .map(item => item.op_id)
    .sort();
  if (!structural.length) throw new Error('個別承認できるsplit/add/delete operationがありません');
  if (JSON.stringify(requested) !== JSON.stringify(structural)) {
    throw new Error('一括契約のため、承認対象のsplit/add/delete operationをすべて個別にチェックしてください');
  }
  return runPatchDryRun(prior.patch, requested);
}

async function loadDryRun(token) {
  const stored = await chrome.storage.session.get(PATCH_DRY_RUN_STORAGE_KEY);
  const value = stored[PATCH_DRY_RUN_STORAGE_KEY];
  if (!value || value.token !== token) throw new Error('dry-run結果が見つからないか、tokenが一致しません。もう一度dry-runしてください');
  return value;
}

function operationSetFromCanonical(region, fields = ['start', 'end', 'text']) {
  const out = {};
  for (const field of fields) {
    if (field === 'start') out.start = region.start;
    else if (field === 'end') out.end = region.end;
    else if (field === 'text') out.text = region.text;
    else if (field === 'speaker') out.speaker = region.speaker;
    else if (field === 'keep') out.keep = region.keep;
    else if (field === 'voice_type') out.voice_type = region.voice_type;
  }
  return out;
}

async function rollbackStructuralJournalInternal(journal, preSnapshot, reason = 'manual', initialErrors = []) {
  const rollbackErrors = [...initialErrors];
  const operations = Array.isArray(journal.operations) ? journal.operations : [];
  const backupRegions = normalizedCanonicalRegions(journal.backup_regions || []);
  let stateIndex = -2;
  if (canonicalRegionListsEqual(preSnapshot?.canonicalRegions, backupRegions)) {
    stateIndex = -1;
  } else {
    for (let index = 0; index < operations.length; index += 1) {
      if (Array.isArray(operations[index]?.expected_regions_after) &&
          canonicalRegionListsEqual(preSnapshot?.canonicalRegions, operations[index].expected_regions_after)) {
        stateIndex = index;
      }
    }
  }

  if (stateIndex === -1) {
    journal.status = reason === 'apply_failure' ? 'rolled_back_after_failure' : 'rolled_back';
    journal.rollback_completed_at = new Date().toISOString();
    journal.rollback_errors = rollbackErrors;
    journal.rollback_fingerprint = journal.backup_source_fingerprint;
    await writeJournal(journal);
    const report = {
      schema: 'aidp-recovery-report/v2',
      generated_at: new Date().toISOString(),
      journal_id: journal.journal_id,
      case_key: journal.case_key,
      reason,
      restored: true,
      already_at_backup: true,
      structural: true,
      status: journal.status,
      errors: rollbackErrors,
      backup_fingerprint: journal.backup_source_fingerprint,
      current_fingerprint: journal.backup_source_fingerprint,
      operations
    };
    await saveLastReport('recovery', report);
    return report;
  }

  if (stateIndex < 0) {
    rollbackErrors.push('現在の全件状態が適用前backupまたは各operation完了状態のいずれとも一致しません。ユーザー編集を上書きしないため自動復元を停止しました');
    journal.status = 'recovery_required';
    journal.rollback_completed_at = new Date().toISOString();
    journal.rollback_errors = rollbackErrors;
    journal.rollback_fingerprint = preSnapshot?.caseData?.source_fingerprint || null;
    await writeJournal(journal);
    const report = {
      schema: 'aidp-recovery-report/v2',
      generated_at: new Date().toISOString(),
      journal_id: journal.journal_id,
      case_key: journal.case_key,
      reason,
      restored: false,
      structural: true,
      status: journal.status,
      errors: rollbackErrors,
      backup_fingerprint: journal.backup_source_fingerprint,
      current_fingerprint: preSnapshot?.caseData?.source_fingerprint || null,
      operations
    };
    await saveLastReport('recovery', report);
    return report;
  }

  const { tab } = await getActiveAidpTab();
  let currentSnapshot = preSnapshot;
  for (let index = stateIndex; index >= 0; index -= 1) {
    const item = operations[index];
    const expectedPrevious = index === 0 ? backupRegions : operations[index - 1].expected_regions_after;
    await mutationProgress(`構造復元中 ${stateIndex - index + 1}/${stateIndex + 1}: ${item.op_id}`, 20 + Math.round(((stateIndex - index) / Math.max(1, stateIndex + 1)) * 55));
    try {
      if (item.type === 'update_region' || item.type === 'set_labels') {
        await performRegionUpdate(tab.id, {
          region_id: item.region_id,
          set: operationSetFromCanonical(item.before, Object.keys(item.set || {})),
          before: item.after,
          after: item.before,
          expected_region_count: expectedPrevious?.length
        });
      } else if (item.type === 'add_region') {
        await performStructuralDelete(tab.id, {
          before: item.after,
          expected_regions_after: expectedPrevious
        });
      } else if (item.type === 'delete_region') {
        await performStructuralAdd(tab.id, {
          after: item.before,
          expected_regions_after: expectedPrevious
        });
      } else if (item.type === 'split_region') {
        const parts = Array.isArray(item.after) ? item.after : [];
        if (parts.length !== 2) throw new Error('split rollback用partが2件ではありません');
        const [first, second] = parts;
        await performNeekoStructure(tab.id, 'remove', second);
        const restoreSet = {};
        for (const field of ['start', 'end', 'text']) {
          if (JSON.stringify(first[field]) !== JSON.stringify(item.before?.[field])) restoreSet[field] = item.before[field];
        }
        if (Object.keys(restoreSet).length) {
          await performRegionUpdate(tab.id, {
            region_id: item.before.region_id,
            set: restoreSet,
            before: first,
            after: item.before,
            expected_region_count: expectedPrevious?.length
          });
        }
      } else {
        throw new Error(`復元未対応operation: ${item.type}`);
      }

      const settlement = await waitForExpectedRegionState(expectedPrevious, 30, ROLLBACK_SETTLEMENT.timeoutMs);
      currentSnapshot = settlement.snapshot || currentSnapshot;
      if (!settlement.ok) throw new Error('operation逆適用後の全件状態が直前状態へ安定して戻りません');
      item.rollback_status = 'applied';
      item.rolled_back_at = new Date().toISOString();
      item.rollback_verify = { attempts: settlement.attempts, elapsed_ms: settlement.elapsed_ms };
    } catch (error) {
      item.rollback_status = 'failed';
      item.rollback_error = error?.message || String(error);
      rollbackErrors.push(`${item.op_id}: ${item.rollback_error}`);
      await writeJournal(journal);
      break;
    }
    await writeJournal(journal);
  }

  const rollbackSettlement = await waitForFingerprint(journal.backup_source_fingerprint);
  currentSnapshot = rollbackSettlement.snapshot || currentSnapshot;
  const restored = rollbackErrors.length === 0 && rollbackSettlement.ok;
  if (!rollbackSettlement.ok) rollbackErrors.push('復元後fingerprintが適用前backupへ安定して戻ったことを確認できません');
  journal.rollback_settlement = { elapsed_ms: rollbackSettlement.elapsed_ms, attempts: rollbackSettlement.attempts };
  journal.status = restored ? (reason === 'apply_failure' ? 'rolled_back_after_failure' : 'rolled_back') : 'recovery_required';
  journal.rollback_completed_at = new Date().toISOString();
  journal.rollback_errors = rollbackErrors;
  journal.rollback_fingerprint = currentSnapshot?.caseData?.source_fingerprint || null;
  await writeJournal(journal);
  const report = {
    schema: 'aidp-recovery-report/v2',
    generated_at: new Date().toISOString(),
    journal_id: journal.journal_id,
    case_key: journal.case_key,
    reason,
    restored,
    structural: true,
    status: journal.status,
    errors: rollbackErrors,
    backup_fingerprint: journal.backup_source_fingerprint,
    current_fingerprint: currentSnapshot?.caseData?.source_fingerprint || null,
    operations
  };
  await saveLastReport('recovery', report);
  return report;
}

async function rollbackJournalInternal(journal, reason = 'manual') {
  journal.status = 'rolling_back';
  journal.rollback_started_at = new Date().toISOString();
  journal.rollback_reason = reason;
  await writeJournal(journal);

  const rollbackErrors = [];
  let preSnapshot = null;
  try {
    preSnapshot = await collectSnapshot(8);
  } catch (error) {
    rollbackErrors.push(`復元前snapshot取得失敗: ${error?.message || String(error)}`);
  }

  if (preSnapshot?.caseData?.case_key && preSnapshot.caseData.case_key !== journal.case_key) {
    rollbackErrors.push('現在開いている案件がjournalの案件と一致しません');
  }

  const hasStructuralOperations = (journal.operations || []).some(item =>
    ['split_region', 'add_region', 'delete_region'].includes(item.type)
  );
  if (hasStructuralOperations) {
    return rollbackStructuralJournalInternal(journal, preSnapshot, reason, rollbackErrors);
  }

  if (preSnapshot?.caseData?.source_fingerprint === journal.backup_source_fingerprint) {
    journal.status = reason === 'apply_failure' ? 'rolled_back_after_failure' : 'rolled_back';
    journal.rollback_completed_at = new Date().toISOString();
    journal.rollback_errors = [];
    journal.rollback_fingerprint = journal.backup_source_fingerprint;
    await writeJournal(journal);
    const alreadyReport = {
      schema: 'aidp-recovery-report/v1',
      generated_at: new Date().toISOString(),
      journal_id: journal.journal_id,
      case_key: journal.case_key,
      reason,
      restored: true,
      already_at_backup: true,
      status: journal.status,
      errors: [],
      backup_fingerprint: journal.backup_source_fingerprint,
      current_fingerprint: journal.backup_source_fingerprint,
      operations: journal.operations
    };
    await saveLastReport('recovery', alreadyReport);
    return alreadyReport;
  }

  const preMap = new Map((preSnapshot?.canonicalRegions || []).map(region => [region.region_id, region]));
  const candidates = [...(journal.operations || [])]
    // executing中にadapterが例外を投げても、AIDP側が部分変更済みの可能性がある。
    // adapter_resultの有無だけで候補から除外せず、現在値をbefore/afterと照合して
    // already_restored / safe rollback / conflict のいずれかへ必ず分類する。
    .filter(item => item.status === 'applied' || item.status === 'executing')
    .reverse();
  const safeToRollback = [];

  for (const item of candidates) {
    const currentRegion = preMap.get(item.region_id);
    if (!currentRegion) {
      rollbackErrors.push(`${item.region_id}: 復元前の現在regionが見つかりません`);
      continue;
    }
    if (canonicalRegionEquals(currentRegion, item.before)) {
      item.rollback_status = 'already_restored';
      continue;
    }
    if (!canonicalRegionEquals(currentRegion, item.after)) {
      item.rollback_status = 'conflict';
      item.rollback_error = '現在値がjournalの変更後値と一致しません。ユーザー編集を上書きしないため停止しました';
      rollbackErrors.push(`${item.region_id}: ${item.rollback_error}`);
      continue;
    }
    safeToRollback.push(item);
  }

  if (rollbackErrors.length) {
    journal.status = 'recovery_required';
    journal.rollback_completed_at = new Date().toISOString();
    journal.rollback_errors = rollbackErrors;
    journal.rollback_fingerprint = preSnapshot?.caseData?.source_fingerprint || null;
    await writeJournal(journal);
    const conflictReport = {
      schema: 'aidp-recovery-report/v1',
      generated_at: new Date().toISOString(),
      journal_id: journal.journal_id,
      case_key: journal.case_key,
      reason,
      restored: false,
      status: journal.status,
      errors: rollbackErrors,
      backup_fingerprint: journal.backup_source_fingerprint,
      current_fingerprint: preSnapshot?.caseData?.source_fingerprint || null,
      operations: journal.operations
    };
    await saveLastReport('recovery', conflictReport);
    return conflictReport;
  }

  const { tab } = await getActiveAidpTab();
  for (let index = 0; index < safeToRollback.length; index += 1) {
    const item = safeToRollback[index];
    await mutationProgress(`復元中 ${index + 1}/${safeToRollback.length}: ${item.region_id}`, 20 + Math.round((index / Math.max(1, safeToRollback.length)) * 55));
    try {
      await performRegionUpdate(tab.id, {
        region_id: item.region_id,
        set: operationSetFromCanonical(item.before, Object.keys(item.set || {})),
        before: item.after,
        after: item.before,
        expected_region_count: Array.isArray(journal.backup_regions) ? journal.backup_regions.length : undefined
      });
      item.rollback_status = 'applied';
      item.rolled_back_at = new Date().toISOString();
    } catch (error) {
      item.rollback_status = 'failed';
      item.rollback_error = error?.message || String(error);
      rollbackErrors.push(`${item.region_id}: ${item.rollback_error}`);
    }
    await writeJournal(journal);
  }

  const rollbackSettlement = await waitForFingerprint(journal.backup_source_fingerprint);
  const current = rollbackSettlement.snapshot || null;
  const restored = rollbackSettlement.ok;
  journal.rollback_settlement = {
    elapsed_ms: rollbackSettlement.elapsed_ms,
    attempts: rollbackSettlement.attempts
  };
  if (!restored) rollbackErrors.push('復元後fingerprintが適用前backupへ安定して戻ったことを確認できません');
  journal.status = rollbackErrors.length ? 'recovery_required' : (reason === 'apply_failure' ? 'rolled_back_after_failure' : 'rolled_back');
  journal.rollback_completed_at = new Date().toISOString();
  journal.rollback_errors = rollbackErrors;
  journal.rollback_fingerprint = current?.caseData?.source_fingerprint || null;
  await writeJournal(journal);
  const report = {
    schema: 'aidp-recovery-report/v1',
    generated_at: new Date().toISOString(),
    journal_id: journal.journal_id,
    case_key: journal.case_key,
    reason,
    restored,
    status: journal.status,
    errors: rollbackErrors,
    backup_fingerprint: journal.backup_source_fingerprint,
    current_fingerprint: current?.caseData?.source_fingerprint || null,
    operations: journal.operations
  };
  await saveLastReport('recovery', report);
  return report;
}

async function applyPatchFromDryRun(token) {
  const stored = await loadDryRun(token);
  const dryRun = stored.report;
  if (!dryRun.applicable) throw new Error('dry-runが適用可能ではありません');
  await mutationProgress('適用直前の案件snapshotを取得しています…', 5);
  let current = await collectSnapshot(5);
  if (current.caseData.source_fingerprint !== dryRun.source_fingerprint || current.caseData.snapshot_id !== dryRun.source_snapshot_id) {
    throw new Error('dry-run後に案件が変化しました。もう一度dry-runしてください');
  }
  const existing = await readJournalByCaseHash(current.caseData.case_hash);
  if (existing && !isJournalFinal(existing.status)) {
    throw new Error(`未完了journalがあります（${existing.status}）。先に復元または永続化確認を行ってください`);
  }

  const applicableOps = dryRun.operations.filter(item => item.status === 'applicable');
  const journal = {
    schema: 'aidp-transaction-journal/v1',
    journal_id: `journal-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    bridge_version: VERSION,
    created_at: new Date().toISOString(),
    case_key: current.caseData.case_key,
    case_hash: current.caseData.case_hash,
    status: 'prepared',
    dry_run_token: token,
    patch_hash: dryRun.patch_hash,
    backup_snapshot_id: current.caseData.snapshot_id,
    backup_source_fingerprint: current.caseData.source_fingerprint,
    apply_page_instance_id: current.caseData.page_instance_id,
    apply_document_time_origin_ms: current.caseData.document_time_origin_ms,
    backup_regions: current.canonicalRegions,
    expected_result_fingerprint: dryRun.expected_result_fingerprint,
    operations: applicableOps.map(item => {
      const structural = ['split_region', 'add_region', 'delete_region'].includes(item.type);
      const resolvedRegionId = item.type === 'add_region' ? item.after?.region_id : item.region_id;
      return {
        op_id: item.op_id,
        type: item.type,
        region_id: resolvedRegionId,
        reason: item.reason,
        before: item.before,
        after: item.after,
        set: structural ? {} : Object.fromEntries(item.changes.map(change => [change.field, change.after])),
        expected_regions_after: item.expected_regions_after,
        expected_region_count: item.expected_regions_after?.length ?? current.canonicalRegions.length,
        status: 'pending'
      };
    })
  };
  await writeJournal(journal);

  try {
    const { tab } = await getActiveAidpTab();
    journal.status = 'applying';
    journal.apply_started_at = new Date().toISOString();
    await writeJournal(journal);

    for (let index = 0; index < journal.operations.length; index += 1) {
      const item = journal.operations[index];
      await mutationProgress(`適用中 ${index + 1}/${journal.operations.length}: ${item.region_id}`, 12 + Math.round(index / Math.max(1, journal.operations.length) * 65));
      item.status = 'executing';
      item.started_at = new Date().toISOString();
      await writeJournal(journal);
      const operationResult = await performPatchOperation(tab.id, item);
      item.adapter_result = operationResult;
      const settlement = await waitForExpectedRegionState(item.expected_regions_after, 25 + index * 2);
      current = settlement.snapshot || current;
      item.verify = {
        ok: settlement.ok,
        attempts: settlement.attempts,
        elapsed_ms: settlement.elapsed_ms,
        settlement_timeout_ms: APPLY_SETTLEMENT.timeoutMs,
        expected_region_count: item.expected_regions_after?.length ?? null
      };
      if (!settlement.ok) {
        const lastAttempt = settlement.attempts?.at(-1);
        const pendingError = new Error(`${item.region_id || item.op_id}の全件反映が${Math.round(APPLY_SETTLEMENT.timeoutMs / 1000)}秒以内に確定しませんでした: ${lastAttempt?.error || (lastAttempt?.errors || []).join(' / ') || '全件状態または三重照合が未一致'}`);
        pendingError.code = 'AIDP_SETTLEMENT_PENDING';
        pendingError.defer_recovery = true;
        pendingError.settlement = item.verify;
        throw pendingError;
      }
      item.status = 'applied';
      item.applied_at = new Date().toISOString();
      item.result_fingerprint = current.caseData.source_fingerprint;
      await writeJournal(journal);
    }

    if (current.caseData.source_fingerprint !== dryRun.expected_result_fingerprint) {
      throw new Error('全操作後fingerprintがdry-run予定値と一致しません');
    }
    journal.status = 'applied_pending_persistence';
    journal.apply_completed_at = new Date().toISOString();
    journal.post_apply_snapshot_id = current.caseData.snapshot_id;
    journal.post_apply_fingerprint = current.caseData.source_fingerprint;
    await writeJournal(journal);
    const report = {
      schema: 'aidp-apply-report/v1',
      generated_at: new Date().toISOString(),
      journal_id: journal.journal_id,
      case_key: journal.case_key,
      pass: true,
      status: journal.status,
      operation_count: journal.operations.length,
      before_fingerprint: journal.backup_source_fingerprint,
      after_fingerprint: journal.post_apply_fingerprint,
      expected_result_fingerprint: journal.expected_result_fingerprint,
      persistence_confirmed: false,
      submitted: false,
      staged: false,
      operations: journal.operations
    };
    await saveLastReport('apply', report);
    return report;
  } catch (error) {
    journal.apply_error = error?.message || String(error);
    if (error?.defer_recovery) {
      journal.status = 'applied_pending_verification';
      journal.verification_pending_at = new Date().toISOString();
      journal.pending_reason = error.code || 'AIDP_SETTLEMENT_PENDING';
      await writeJournal(journal);
      const pendingReport = {
        schema: 'aidp-apply-report/v1',
        generated_at: new Date().toISOString(),
        journal_id: journal.journal_id,
        case_key: journal.case_key,
        pass: false,
        pending_verification: true,
        status: journal.status,
        operation_count: journal.operations.length,
        before_fingerprint: journal.backup_source_fingerprint,
        after_fingerprint: current?.caseData?.source_fingerprint || null,
        expected_result_fingerprint: journal.expected_result_fingerprint,
        persistence_confirmed: false,
        submitted: false,
        staged: false,
        error: journal.apply_error,
        operations: journal.operations
      };
      await saveLastReport('apply', pendingReport);
      return pendingReport;
    }
    journal.status = 'apply_failed_compensating';
    await writeJournal(journal);
    const recovery = await rollbackJournalInternal(journal, 'apply_failure');
    const wrapped = new Error(`${journal.apply_error}
自動補償復元: ${recovery.restored ? '成功' : '要確認'}`);
    wrapped.recovery = recovery;
    throw wrapped;
  }
}

async function waitForReloadComplete(tabId, expectedPathname, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveComplete = 0;
  while (Date.now() < deadline) {
    let currentTab = null;
    try { currentTab = await chrome.tabs.get(tabId); } catch (_) {}
    let pathname = '';
    try { pathname = new URL(currentTab?.url || '').pathname; } catch (_) {}
    const complete = currentTab?.status === 'complete' && pathname === expectedPathname;
    consecutiveComplete = complete ? consecutiveComplete + 1 : 0;
    if (consecutiveComplete >= 3) return currentTab;
    const elapsed = timeoutMs - Math.max(0, deadline - Date.now());
    const percent = 12 + Math.min(18, Math.round((elapsed / timeoutMs) * 18));
    await mutationProgress('AIDPページ本体の読み込み完了を待っています…', percent);
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error('AIDPページの読み込み完了を120秒以内に確認できませんでした');
}

async function waitPostLoadGrace(tabId, expectedPathname, waitMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const currentTab = await chrome.tabs.get(tabId);
    let pathname = '';
    try { pathname = new URL(currentTab?.url || '').pathname; } catch (_) {}
    if (pathname !== expectedPathname) throw new Error('再読み込み中に別のページへ移動しました');
    const remaining = Math.max(0, Math.ceil((waitMs - (Date.now() - startedAt)) / 1000));
    const ratio = Math.min(1, (Date.now() - startedAt) / waitMs);
    await mutationProgress(`AIDP内部データの展開を待っています… 残り約${remaining}秒`, 30 + Math.round(ratio * 25));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function waitForAidpReady(tabId, expectedPathname, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let stableSignature = '';
  let stableCount = 0;
  let lastDetail = '';
  while (Date.now() < deadline) {
    try {
      const currentTab = await chrome.tabs.get(tabId);
      let pathname = '';
      try { pathname = new URL(currentTab?.url || '').pathname; } catch (_) {}
      if (currentTab?.status !== 'complete' || pathname !== expectedPathname) {
        stableCount = 0;
        lastDetail = 'タブ読み込み中';
      } else {
        const ping = await pingContent(tabId);
        const structure = ping?.structure || {};
        const main = await collectMainWorld(tabId);
        const tableCount = Number(structure.total_count_display || 0);
        const visibleRows = Number(structure.visible_rows || 0);
        const modelCount = Array.isArray(main?.model_regions) ? main.model_regions.length : 0;
        const waveCount = Array.isArray(main?.wave_regions) ? main.wave_regions.length : 0;
        const ready = ping?.ok && structure.ready_state === 'complete' &&
          tableCount > 0 && visibleRows > 0 &&
          main?.ok && modelCount === tableCount && waveCount === tableCount;
        const signature = [pathname, tableCount, visibleRows, modelCount, waveCount, main?.duration].join('|');
        if (ready && signature === stableSignature) stableCount += 1;
        else stableCount = ready ? 1 : 0;
        stableSignature = signature;
        lastDetail = `Table=${tableCount}, Model=${modelCount}, Wave=${waveCount}`;
        if (stableCount >= 3) return { ping, main, detail: lastDetail };
      }
    } catch (error) {
      stableCount = 0;
      lastDetail = error?.message || String(error);
    }
    const elapsed = timeoutMs - Math.max(0, deadline - Date.now());
    const percent = 55 + Math.min(20, Math.round((elapsed / timeoutMs) * 20));
    await mutationProgress(`AIDPの表・波形・内部モデルが揃うまで待っています… ${lastDetail}`, percent);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`AIDPの準備完了を確認できませんでした（${lastDetail || '状態不明'}）`);
}

async function collectStablePersistenceSnapshot(expectedPathname, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let previousFingerprint = '';
  let lastFingerprint = '';
  let stableCount = 0;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const { url } = await getActiveAidpTab();
      if (url.pathname !== expectedPathname) throw new Error('確認対象の案件ページが変わりました');
      const snapshot = await collectSnapshot(76);
      const fingerprint = snapshot.caseData.source_fingerprint;
      lastFingerprint = fingerprint || lastFingerprint;
      const tripleMatch = snapshot.summary?.validation?.triple_match === true || snapshot.capabilities?.validation?.triple_match === true;
      if (fingerprint && fingerprint === previousFingerprint && tripleMatch) stableCount += 1;
      else stableCount = fingerprint && tripleMatch ? 1 : 0;
      previousFingerprint = fingerprint;
      if (stableCount >= 2) return snapshot;
      lastError = tripleMatch ? `fingerprint安定待ち（${stableCount}/2）` : 'Model／Wave／Table三重照合が不一致';
    } catch (error) {
      stableCount = 0;
      lastError = error?.message || String(error);
    }
    await mutationProgress(`再読み込み後の全件状態が安定するまで待っています… ${lastError}`, 82);
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw new Error(`再読み込み後の安定snapshotを取得できませんでした（${lastError || '状態不明'}${lastFingerprint ? `, last=${lastFingerprint}` : ''}）。不安定なsnapshotは判定に使用していません`);
}

async function confirmPersistence() {
  const { tab, url } = await getActiveAidpTab();
  const caseHash = (await sha256Text(url.pathname)).slice(0, 16);
  const journal = await readJournalByCaseHash(caseHash);
  if (!journal || !['applied_pending_persistence', 'applied_pending_verification'].includes(journal.status)) {
    throw new Error('永続化または反映確認待ちのjournalがありません');
  }
  if (journal.bridge_version !== VERSION) {
    throw new Error(`journal作成版（${journal.bridge_version || 'unknown'}）と現在の拡張版（${VERSION}）が一致しません。安全のため保持確認を停止しました`);
  }
  if (!journal.apply_page_instance_id) {
    throw new Error('適用時のページ固有IDがjournalにありません。手動再読み込みの実行を証明できないため保持確認を停止しました');
  }

  // Beta 10: このボタンからはAIDPを再読み込みしない。
  // 通信が遅い環境でも、押下後45秒間はcontent script / React / Wave / Tableへ一切問い合わせない。
  const initialDelayMs = 45000;
  const delayStartedAt = Date.now();
  while (Date.now() - delayStartedAt < initialDelayMs) {
    const remaining = Math.max(0, Math.ceil((initialDelayMs - (Date.now() - delayStartedAt)) / 1000));
    const ratio = Math.min(1, (Date.now() - delayStartedAt) / initialDelayMs);
    await mutationProgress(`AIDPの読み込み待機中です。まだ検査しません… 残り約${remaining}秒`, 5 + Math.round(ratio * 35));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const currentTab = await chrome.tabs.get(tab.id);
  let currentPathname = '';
  try { currentPathname = new URL(currentTab?.url || '').pathname; } catch (_) {}
  if (currentPathname !== url.pathname) throw new Error('待機中に別のページへ移動しました');

  const reloadPing = await pingContent(tab.id);
  const currentPageInstanceId = String(reloadPing.page_instance_id || '');
  const applyPageInstanceId = String(journal.apply_page_instance_id || '');
  if (!currentPageInstanceId || currentPageInstanceId === applyPageInstanceId) {
    journal.persistence_last_attempt_at = new Date().toISOString();
    journal.persistence_last_error = '手動再読み込みを確認できませんでした';
    journal.persistence_observed_page_instance_id = currentPageInstanceId || null;
    await writeJournal(journal);
    throw new Error('手動再読み込みを確認できません。AIDPページをCtrl+Rで再読み込みし、読み込み開始後または完了後にもう一度保持確認を実行してください');
  }
  journal.persistence_reload_verified_at = new Date().toISOString();
  journal.persistence_observed_page_instance_id = currentPageInstanceId;
  journal.persistence_observed_document_time_origin_ms = Number(reloadPing.document_time_origin_ms || 0) || null;
  journal.persistence_last_error = '';
  await writeJournal(journal);

  await waitForReloadComplete(tab.id, url.pathname, 120000);
  await waitForAidpReady(tab.id, url.pathname, 120000);
  await mutationProgress('AIDPの準備完了を確認しました。全件snapshotを取得します…', 76);
  const current = await collectStablePersistenceSnapshot(url.pathname, 120000);
  const expectedFingerprint = journal.expected_result_fingerprint || journal.post_apply_fingerprint;
  const confirmed = current.caseData.source_fingerprint === expectedFingerprint;
  const revertedToBackup = current.caseData.source_fingerprint === journal.backup_source_fingerprint;
  journal.persistence_checked_at = new Date().toISOString();
  journal.persistence_fingerprint = current.caseData.source_fingerprint;
  if (confirmed) {
    journal.post_apply_fingerprint = current.caseData.source_fingerprint;
    journal.post_apply_snapshot_id = current.caseData.snapshot_id;
    journal.status = 'confirmed';
  } else if (revertedToBackup) {
    journal.status = 'not_applied';
    journal.finalized_at = new Date().toISOString();
    journal.not_applied_reason = '再読み込み後に適用前backup fingerprintへ戻ったため、変更未反映として終了';
  } else {
    journal.status = 'persistence_mismatch';
  }
  await writeJournal(journal);
  const report = {
    schema: 'aidp-persistence-report/v1',
    generated_at: new Date().toISOString(),
    journal_id: journal.journal_id,
    case_key: journal.case_key,
    confirmed,
    expected_fingerprint: expectedFingerprint,
    current_fingerprint: current.caseData.source_fingerprint,
    reverted_to_backup: revertedToBackup,
    reload_evidence: {
      apply_page_instance_id: journal.apply_page_instance_id,
      observed_page_instance_id: current.caseData.page_instance_id || currentPageInstanceId,
      page_instance_changed: (current.caseData.page_instance_id || currentPageInstanceId) !== journal.apply_page_instance_id,
      apply_document_time_origin_ms: journal.apply_document_time_origin_ms || null,
      observed_document_time_origin_ms: current.caseData.document_time_origin_ms || reloadPing.document_time_origin_ms || null
    },
    readiness_wait: {
      auto_reload: false,
      initial_no_inspection_delay_ms: 45000,
      tab_complete_waited: true,
      post_load_grace_ms: 0,
      stable_snapshot_required: 2
    },
    submitted: false,
    staged: false
  };
  await saveLastReport('persistence', report);
  if (!confirmed && !revertedToBackup) throw new Error('再読み込み後の状態が適用結果ともbackupとも一致しません');
  return report;
}

async function getCurrentJournalStatus() {
  try {
    const { url } = await getActiveAidpTab();
    const caseHash = (await sha256Text(url.pathname)).slice(0, 16);
    const journal = await readJournalByCaseHash(caseHash);
    if (!journal) return null;

    // A service-worker restart or side-panel disconnect can leave a journal at
    // `applying` even though no mutation job is running. Reconcile only when
    // the live case is provably identical to the pre-apply backup. This is a
    // metadata-only recovery: AIDP is not mutated and submit/stage are untouched.
    if (journal.status === 'applying' && !activeMutationJob) {
      try {
        const snapshot = await collectSnapshot(0);
        if (
          snapshot?.caseData?.case_key === journal.case_key &&
          snapshot?.caseData?.source_fingerprint === journal.backup_source_fingerprint
        ) {
          journal.status = 'rolled_back';
          journal.rollback_reason = 'stale_applying_reconciled_at_backup';
          journal.rollback_completed_at = new Date().toISOString();
          journal.rollback_errors = [];
          journal.rollback_fingerprint = journal.backup_source_fingerprint;
          await writeJournal(journal);
          const report = {
            schema: 'aidp-recovery-report/v1',
            generated_at: new Date().toISOString(),
            bridge_version: VERSION,
            journal_id: journal.journal_id,
            case_key: journal.case_key,
            reason: 'stale_applying_reconciled_at_backup',
            restored: true,
            already_at_backup: true,
            metadata_only: true,
            status: journal.status,
            errors: [],
            backup_fingerprint: journal.backup_source_fingerprint,
            current_fingerprint: snapshot.caseData.source_fingerprint,
            operations: journal.operations
          };
          await saveLastReport('recovery', report);
        }
      } catch (_) {
        // Keep the journal visible and let the user run explicit rollback.
      }
    }
    return journal;
  } catch (_) {
    return null;
  }
}

async function createJsonBlobUrl(payload) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'AIDP_CREATE_JSON_FILE',
    payload
  });
  if (!response?.ok) throw new Error(response?.error || 'JSONレポートを作成できません');
  return response.result;
}

async function downloadLastReport(kind) {
  const stored = await chrome.storage.local.get(LAST_REPORT_STORAGE_KEY);
  const report = stored[LAST_REPORT_STORAGE_KEY]?.[kind];
  if (!report) throw new Error(`${kind}レポートがありません`);
  const file = await createJsonBlobUrl({
    filename: `aidp_${kind}_report_${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`,
    value: report
  });
  const downloadId = await chrome.downloads.download({ url: file.blobUrl, filename: file.filename, saveAs: true });
  return { filename: file.filename, downloadId };
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'AIDP_GET_ACTIVE_STATUS') {
    (async () => {
      try {
        const { tab, url } = await getActiveAidpTab();
        const ping = await pingContent(tab.id);
        sendResponse({ ok: Boolean(ping?.ok), case_key: url.pathname, version: ping?.version || '' });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'AIDP_GET_MAIN_DIAGNOSTICS') {
    (async () => {
      try {
        const tabId = sender?.tab?.id;
        if (!tabId) throw new Error('診断対象タブを特定できません');
        const main = await collectMainWorld(tabId);
        sendResponse({
          ok: true,
          diagnostics: {
            ok: main.ok === true,
            error: main.error || '',
            adapter: main.adapter || '',
            capability: main.capability || {},
            counts: {
              model: Array.isArray(main.model_regions) ? main.model_regions.length : 0,
              wave: Array.isArray(main.wave_regions) ? main.wave_regions.length : 0
            },
            duration: main.duration ?? null
          }
        });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'AIDP_RUN_INSPECTION') {
    (async () => {
      try {
        const snapshot = await runInspection();
        sendResponse({ ok: true, summary: snapshot.summary });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'AIDP_EXPORT_CASE_ZIP') {
    sendResponse({
      ok: false,
      error: 'v0.7 Integrated Betaでは長時間のZIP書き出しをPortジョブで実行します。Side Panelから開始してください。'
    });
    return;
  }

  if (message.type === 'AIDP_GET_EXPORT_JOB_STATUS') {
    (async () => {
      try {
        const stored = await chrome.storage.session.get(EXPORT_JOB_STORAGE_KEY);
        let job = stored[EXPORT_JOB_STORAGE_KEY] || null;
        if (job && ['running', 'starting'].includes(job.status) && !activeExportJob) {
          job = {
            ...job,
            status: 'interrupted',
            interrupted_at: new Date().toISOString(),
            error: '前回の書き出し処理は完了通知前に中断されました。自動再試行はしていません。',
            text: '前回の書き出し処理は中断されました'
          };
          await chrome.storage.session.set({ [EXPORT_JOB_STORAGE_KEY]: job });
        }
        sendResponse({ ok: true, job });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }


  if (message.type === 'AIDP_PATCH_DRY_RUN') {
    (async () => {
      try {
        const report = await runPatchDryRun(message.patch);
        sendResponse({ ok: true, report });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'AIDP_APPROVE_STRUCTURAL_DRY_RUN') {
    (async () => {
      try {
        const report = await approveStructuralDryRun(String(message.token || ''), message.op_ids || []);
        sendResponse({ ok: true, report });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'AIDP_GET_JOURNAL_STATUS') {
    (async () => {
      try {
        sendResponse({ ok: true, journal: await getCurrentJournalStatus(), feature_flags: cloneJson(FEATURE_FLAGS) });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'AIDP_DOWNLOAD_LAST_REPORT') {
    (async () => {
      try {
        sendResponse({ ok: true, result: await downloadLastReport(String(message.kind || '')) });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== EXPORT_PORT_NAME) return;

  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (activeExportJob?.port === port) activeExportJob.port = null;
  });

  port.onMessage.addListener(message => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'PING') {
      try { port.postMessage({ type: 'PONG', at: Date.now(), job_id: activeExportJob?.id || '' }); }
      catch (_) {}
      return;
    }

    if (message.type !== 'START_EXPORT') return;

    if (activeMutationJob) {
      try {
        port.postMessage({ type: 'ERROR', job_id: message.job_id || '', error: 'AIDP変更・復元処理中はZIP書き出しを開始できません' });
      } catch (_) {}
      return;
    }

    if (activeExportJob) {
      try {
        port.postMessage({
          type: 'ERROR',
          job_id: message.job_id || '',
          error: `別の書き出し処理が進行中です（job=${activeExportJob.id}）`
        });
      } catch (_) {}
      return;
    }

    const jobId = String(message.job_id || `export-${Date.now()}`);
    activeExportJob = {
      id: jobId,
      port,
      state: {
        job_id: jobId,
        status: 'starting',
        started_at: new Date().toISOString(),
        text: 'ZIP書き出しを開始します',
        percent: 1
      }
    };

    void writeExportJobState(activeExportJob.state);
    try { port.postMessage({ type: 'STARTED', job_id: jobId }); }
    catch (_) {}

    void (async () => {
      try {
        const result = await exportZip(message.options || {});
        await writeExportJobState({
          job_id: jobId,
          status: 'completed',
          completed_at: new Date().toISOString(),
          text: `ZIP保存を開始しました: ${result.filename}`,
          percent: 100,
          result: {
            filename: result.filename,
            downloadId: result.downloadId,
            partial: result.partial
          }
        });
        if (!disconnected) {
          try { port.postMessage({ type: 'RESULT', job_id: jobId, result }); }
          catch (_) {}
        }
      } catch (error) {
        const errorText = error?.message || String(error);
        await writeExportJobState({
          job_id: jobId,
          status: 'failed',
          failed_at: new Date().toISOString(),
          text: errorText,
          error: errorText
        });
        if (!disconnected) {
          try { port.postMessage({ type: 'ERROR', job_id: jobId, error: errorText }); }
          catch (_) {}
        }
      } finally {
        if (activeExportJob?.id === jobId) activeExportJob = null;
      }
    })();
  });
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== MUTATION_PORT_NAME) return;

  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (activeMutationJob?.port === port) activeMutationJob.port = null;
  });

  port.onMessage.addListener(message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'PING') {
      try { port.postMessage({ type: 'PONG', at: Date.now(), job_id: activeMutationJob?.id || '' }); } catch (_) {}
      return;
    }
    if (message.type !== 'START_MUTATION') return;
    if (activeExportJob) {
      try { port.postMessage({ type: 'ERROR', job_id: message.job_id || '', error: '案件ZIP書き出し中は変更処理を開始できません' }); } catch (_) {}
      return;
    }
    if (activeMutationJob) {
      try { port.postMessage({ type: 'ERROR', job_id: message.job_id || '', error: `別の変更処理が進行中です（job=${activeMutationJob.id}）` }); } catch (_) {}
      return;
    }

    const jobId = String(message.job_id || `mutation-${Date.now()}`);
    const action = String(message.action || '');
    activeMutationJob = {
      id: jobId,
      port,
      state: { job_id: jobId, action, status: 'starting', started_at: new Date().toISOString(), text: '処理を開始します', percent: 1 }
    };
    try { port.postMessage({ type: 'STARTED', job_id: jobId, action }); } catch (_) {}

    void (async () => {
      try {
        let result;
        if (action === 'apply') result = await applyPatchFromDryRun(String(message.token || ''));
        else if (action === 'rollback') {
          const journal = await getCurrentJournalStatus();
          if (!journal) throw new Error('復元対象journalがありません');
          result = await rollbackJournalInternal(journal, 'manual');
        } else if (action === 'confirm_persistence') result = await confirmPersistence();
        else throw new Error(`不明な変更処理: ${action}`);
        await mutationProgress('処理が完了しました', 100);
        if (!disconnected) {
          try { port.postMessage({ type: 'RESULT', job_id: jobId, action, result }); } catch (_) {}
        }
      } catch (error) {
        const errorText = error?.message || String(error);
        if (action === 'apply') {
          try {
            const journal = await getCurrentJournalStatus();
            const failureReport = {
              schema: 'aidp-apply-report/v1',
              generated_at: new Date().toISOString(),
              bridge_version: VERSION,
              pass: false,
              status: journal?.status || 'failed_before_journal',
              phase: journal?.status || 'precheck_or_start',
              error: errorText,
              recovery: error?.recovery || null,
              journal_id: journal?.journal_id || null,
              case_key: journal?.case_key || null,
              before_fingerprint: journal?.backup_source_fingerprint || null,
              after_fingerprint: journal?.post_apply_fingerprint || null,
              expected_result_fingerprint: journal?.expected_result_fingerprint || null,
              operation_count: journal?.operations?.length || 0,
              operations: journal?.operations || [],
              persistence_confirmed: false,
              submitted: false,
              staged: false
            };
            await saveLastReport('apply', failureReport);
          } catch (reportError) {
            console.warn('apply failure report save failed', reportError);
          }
        }
        if (!disconnected) {
          try { port.postMessage({ type: 'ERROR', job_id: jobId, action, error: errorText, recovery: error?.recovery || null }); } catch (_) {}
        }
      } finally {
        if (activeMutationJob?.id === jobId) activeMutationJob = null;
      }
    })();
  });
});
