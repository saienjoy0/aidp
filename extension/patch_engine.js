(() => {
  'use strict';

  const EPS = 0.0025;
  const ALLOWED_OPERATION_TYPES = new Set([
    'update_region', 'set_labels', 'split_region', 'add_region', 'delete_region'
  ]);
  const DEFAULT_EDITABLE_FIELDS = new Set(['start', 'end', 'text']);
  const RESTRICTED_FIELDS = new Set(['speaker', 'keep', 'voice_type']);

  const clone = value => JSON.parse(JSON.stringify(value));
  const normalizeText = value => String(value ?? '').replace(/\r\n/g, '\n');
  const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const round6 = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;

  const STRUCTURAL_PLACEHOLDER_PREFIX = '__aidp_bridge_native__';

  function makeStructuralPlaceholderId(operation, partIndex, usedIds) {
    const base = String(operation?.op_id || 'op')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .slice(0, 80) || 'op';
    let candidate = `${STRUCTURAL_PLACEHOLDER_PREFIX}${base}__${partIndex}`;
    let serial = 1;
    while (usedIds.has(candidate)) {
      candidate = `${STRUCTURAL_PLACEHOLDER_PREFIX}${base}__${partIndex}_${serial}`;
      serial += 1;
    }
    usedIds.add(candidate);
    return candidate;
  }

  function isStructuralPlaceholderId(value) {
    return String(value || '').startsWith(STRUCTURAL_PLACEHOLDER_PREFIX);
  }

  function sortAndRenumber(regions) {
    // Mirror the live AIDP template exactly: stable sort by start only.
    regions.sort((a, b) => Number(a.start) - Number(b.start));
    regions.forEach((region, index) => {
      region.round_id = index + 1;
      region.duration = round6(Number(region.end) - Number(region.start));
    });
    return regions;
  }

  function canonicalSimulation(regions) {
    return regions.map(region => ({
      region_id: String(region.region_id || ''),
      start: round6(region.start),
      end: round6(region.end),
      text: normalizeText(region.text),
      speaker: String(region.speaker ?? ''),
      keep: String(region.keep ?? ''),
      voice_type: String(region.voice_type ?? ''),
      quality: String(region.quality ?? ''),
      round_id: Number.isFinite(Number(region.round_id)) ? Number(region.round_id) : null
    }));
  }

  function stableObject(value) {
    if (Array.isArray(value)) return value.map(stableObject);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
    return out;
  }

  function stableStringify(value) {
    return JSON.stringify(stableObject(value));
  }

  function normalizePatch(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('修正JSONのルートはオブジェクトである必要があります');
    }
    const operations = Array.isArray(input.operations)
      ? input.operations
      : Array.isArray(input.changes)
        ? input.changes.map((change, index) => ({
            op_id: change.op_id || `legacy-${index + 1}`,
            type: 'update_region',
            region_id: change.region_id,
            expected: change.expected || {},
            set: {
              ...(change.start !== undefined ? { start: change.start } : {}),
              ...(change.end !== undefined ? { end: change.end } : {}),
              ...(change.text !== undefined ? { text: change.text } : {}),
              ...(change.speaker !== undefined ? { speaker: change.speaker } : {})
            },
            reason: change.reason || ''
          }))
        : [];

    return {
      schema: String(input.schema || 'aidp-chatgpt-patch/v3'),
      case_key: String(input.case_key || input.case_id || ''),
      source_snapshot_id: String(input.source_snapshot_id || ''),
      source_fingerprint: String(input.source_fingerprint || ''),
      generated_at: input.generated_at ? String(input.generated_at) : '',
      operations: operations.map((operation, index) => ({
        op_id: String(operation?.op_id || `op-${String(index + 1).padStart(3, '0')}`),
        type: String(operation?.type || 'update_region'),
        region_id: String(operation?.region_id || ''),
        expected: operation?.expected && typeof operation.expected === 'object' ? clone(operation.expected) : {},
        set: operation?.set && typeof operation.set === 'object' ? clone(operation.set) : {},
        reason: String(operation?.reason || ''),
        confidence: Number.isFinite(Number(operation?.confidence)) ? Number(operation.confidence) : null,
        requires_user_review: operation?.requires_user_review === true,
        parts: Array.isArray(operation?.parts) ? clone(operation.parts) : undefined,
        region: operation?.region && typeof operation.region === 'object' ? clone(operation.region) : undefined,
        allow_overlap: operation?.allow_overlap === true
      }))
    };
  }

  function expectedMatches(current, expected) {
    const mismatches = [];
    if (!expected || typeof expected !== 'object') return mismatches;
    for (const key of ['start', 'end']) {
      if (expected[key] === undefined) continue;
      const actual = numberOrNull(current[key]);
      const wanted = numberOrNull(expected[key]);
      if (actual == null || wanted == null || Math.abs(actual - wanted) > EPS) {
        mismatches.push({ field: key, expected: wanted, actual });
      }
    }
    for (const key of ['text', 'speaker', 'keep', 'voice_type']) {
      if (expected[key] === undefined) continue;
      const actual = key === 'text' ? normalizeText(current[key]) : String(current[key] ?? '');
      const wanted = key === 'text' ? normalizeText(expected[key]) : String(expected[key] ?? '');
      if (actual !== wanted) mismatches.push({ field: key, expected: wanted, actual });
    }
    return mismatches;
  }

  function diffFields(before, after) {
    const fields = [];
    for (const key of ['start', 'end', 'text', 'speaker', 'keep', 'voice_type']) {
      const a = key === 'text' ? normalizeText(before[key]) : before[key];
      const b = key === 'text' ? normalizeText(after[key]) : after[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) fields.push({ field: key, before: a, after: b });
    }
    return fields;
  }

  function validateRegionGeometry(regions, platformDuration, ruleset) {
    const errors = [];
    const warnings = [];
    const review = [];
    const maxDuration = Number(ruleset?.time_rules?.normal_region_max_sec ?? 10);
    const lyricsExempt = ruleset?.time_rules?.lyrics_exempt_from_10_sec === true;
    const tolerance = 0.05;

    for (const region of regions) {
      if (!Number.isFinite(region.start) || !Number.isFinite(region.end)) {
        errors.push(`${region.region_id}: start/endが数値ではありません`);
        continue;
      }
      if (region.start < 0) errors.push(`${region.region_id}: startが0未満です`);
      if (region.end <= region.start) errors.push(`${region.region_id}: endはstartより後である必要があります`);
      if (Number.isFinite(platformDuration) && region.end > platformDuration + tolerance) {
        errors.push(`${region.region_id}: end=${region.end.toFixed(3)}秒がAIDP波形長${platformDuration.toFixed(3)}秒を超えます`);
      }
      const duration = region.end - region.start;
      if (duration > maxDuration && region.keep !== '丢弃' && !(lyricsExempt && region.voice_type === '歌词')) {
        warnings.push(`${region.region_id}: ${maxDuration}秒超（${duration.toFixed(3)}秒）`);
      }
    }

    const ordered = [...regions].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length && ordered[j].start < ordered[i].end; j += 1) {
        const overlap = Math.min(ordered[i].end, ordered[j].end) - Math.max(ordered[i].start, ordered[j].start);
        if (overlap <= 0.0005) continue;
        const a = ordered[i];
        const b = ordered[j];
        if (a.keep === '丢弃' || b.keep === '丢弃') continue;
        const sameSpeaker = a.speaker && b.speaker && !/^unk$/i.test(a.speaker) && a.speaker === b.speaker;
        if (sameSpeaker) warnings.push(`${a.region_id}/${b.region_id}: 同一話者で${overlap.toFixed(3)}秒重複`);
        else review.push(`${a.region_id}/${b.region_id}: ${overlap.toFixed(3)}秒重複。正しい同時発話かユーザー確認が必要です`);
      }
    }
    return { errors, warnings, review };
  }

  function dryRun(patchInput, snapshot, options = {}) {
    const patch = normalizePatch(patchInput);
    const flags = {
      update_region: options.featureFlags?.update_region !== false,
      set_labels: options.featureFlags?.set_labels === true,
      split_region: options.featureFlags?.split_region === true,
      add_region: options.featureFlags?.add_region === true,
      delete_region: options.featureFlags?.delete_region === true
    };
    const errors = [];
    const warnings = [];
    const reviewRequired = [];
    const operationResults = [];
    const approvedStructuralOpIds = new Set(
      Array.isArray(options.approvedStructuralOpIds) ? options.approvedStructuralOpIds.map(String) : []
    );

    if (!['aidp-chatgpt-patch/v3', 'aidp-chatgpt-patch/v2'].includes(patch.schema)) {
      errors.push(`未対応schema: ${patch.schema}`);
    } else if (patch.schema === 'aidp-chatgpt-patch/v2') {
      warnings.push('v2 patchを互換モードで読み込みました。正式形式はaidp-chatgpt-patch/v3です');
    }
    if (!patch.case_key) errors.push('case_keyがありません');
    if (patch.case_key && patch.case_key !== snapshot.caseData.case_key) {
      errors.push(`案件不一致: patch=${patch.case_key} / current=${snapshot.caseData.case_key}`);
    }
    if (!patch.source_snapshot_id) errors.push('source_snapshot_idがありません');
    else if (patch.source_snapshot_id !== snapshot.caseData.snapshot_id) {
      errors.push('source_snapshot_idが現在案件と一致しません');
    }
    if (!patch.source_fingerprint) errors.push('source_fingerprintがありません');
    else if (patch.source_fingerprint !== snapshot.caseData.source_fingerprint) {
      errors.push('source_fingerprintが現在案件と一致しません');
    }
    if (!patch.operations.length) errors.push('operationsが空です');

    const simulated = snapshot.regionsData.regions.map(region => ({ ...clone(region) }));
    const map = new Map(simulated.map(region => [region.region_id, region]));
    const opIds = new Set();
    const targetedRegionIds = new Set();
    const usedRegionIds = new Set(simulated.map(region => String(region.region_id || '')));

    for (const operation of patch.operations) {
      const result = {
        op_id: operation.op_id,
        type: operation.type,
        region_id: operation.region_id,
        reason: operation.reason,
        confidence: operation.confidence,
        requires_user_review: operation.requires_user_review,
        status: 'rejected',
        errors: [],
        warnings: [],
        review_required: [],
        expected_mismatches: [],
        changes: [],
        before: null,
        after: null,
        expected_regions_after: null
      };
      if (opIds.has(operation.op_id)) result.errors.push('op_idが重複しています');
      opIds.add(operation.op_id);
      if (['update_region', 'set_labels', 'delete_region', 'split_region'].includes(operation.type) && operation.region_id) {
        if (targetedRegionIds.has(operation.region_id)) result.errors.push(`同一regionへの複数operationは1件へ統合してください: ${operation.region_id}`);
        targetedRegionIds.add(operation.region_id);
      }
      if (!ALLOWED_OPERATION_TYPES.has(operation.type)) result.errors.push(`未対応operation type: ${operation.type}`);
      if (!flags[operation.type]) result.errors.push(`${operation.type}は初期feature flagで無効です`);

      if (operation.type === 'update_region' || operation.type === 'set_labels') {
        const current = map.get(operation.region_id);
        if (!operation.region_id) result.errors.push('region_idがありません');
        if (!current) result.errors.push(`region_idが現在案件に存在しません: ${operation.region_id}`);
        if (current) {
          result.before = clone(current);
          const requiredExpected = ['start', 'end', 'text', 'speaker', 'keep', 'voice_type'];
          const missingExpected = requiredExpected.filter(key => operation.expected?.[key] === undefined);
          if (missingExpected.length) result.errors.push(`expected必須項目が不足しています: ${missingExpected.join(', ')}`);
          result.expected_mismatches = expectedMatches(current, operation.expected);
          if (result.expected_mismatches.length) result.errors.push('expectedが現在値と一致しません');
          if (current.keep !== '保留') result.errors.push('初期安全版のupdate_regionは保留regionだけを対象にできます');
          const next = { ...current };
          const setKeys = Object.keys(operation.set || {});
          if (!setKeys.length) result.errors.push('setが空です');
          for (const key of setKeys) {
            if (!DEFAULT_EDITABLE_FIELDS.has(key) && !RESTRICTED_FIELDS.has(key)) {
              result.errors.push(`変更不可フィールド: ${key}`);
              continue;
            }
            if (RESTRICTED_FIELDS.has(key) && !flags.set_labels) {
              result.errors.push(`${key}変更はユーザー判断項目のため初期無効です`);
              continue;
            }
            if (key === 'start' || key === 'end') {
              const value = numberOrNull(operation.set[key]);
              if (value == null) result.errors.push(`${key}は有限数である必要があります`);
              else next[key] = round6(value);
            } else if (key === 'text') next.text = normalizeText(operation.set.text);
            else next[key] = String(operation.set[key] ?? '');
          }
          next.duration = (Number.isFinite(next.start) && Number.isFinite(next.end)) ? round6(next.end - next.start) : next.duration;
          result.changes = diffFields(current, next);
          result.after = clone(next);
          const maxDuration = Number(snapshot.ruleset?.time_rules?.normal_region_max_sec ?? 10);
          const lyricsExempt = snapshot.ruleset?.time_rules?.lyrics_exempt_from_10_sec === true;
          const currentDuration = Number(current.end) - Number(current.start);
          const nextDuration = Number(next.end) - Number(next.start);
          const durationRuleApplies = next.keep !== '丢弃' && !(lyricsExempt && next.voice_type === '歌词');
          if (Number.isFinite(nextDuration) && nextDuration > maxDuration && durationRuleApplies) {
            const existingViolation = Number.isFinite(currentDuration) && currentDuration > maxDuration;
            const worsened = !existingViolation || nextDuration > currentDuration + 0.0005;
            if (worsened) {
              result.errors.push(`修正により通常小条の${maxDuration}秒超が新規発生または悪化します（${nextDuration.toFixed(3)}秒）。分割案が必要です`);
            } else {
              result.warnings.push(`既存の${maxDuration}秒超は残ります（${currentDuration.toFixed(3)}秒 → ${nextDuration.toFixed(3)}秒）。今回の変更では悪化しません`);
            }
          }
          if (!result.changes.length && !result.errors.length) result.errors.push('実質的な変更がありません');
          if (!result.errors.length) {
            map.set(operation.region_id, next);
            const index = simulated.findIndex(region => region.region_id === operation.region_id);
            if (index >= 0) simulated[index] = next;
          }
        }
      } else if (operation.type === 'split_region') {
        const current = map.get(operation.region_id);
        if (!operation.region_id) result.errors.push('region_idがありません');
        if (!current) result.errors.push(`region_idが現在案件に存在しません: ${operation.region_id}`);
        if (current) {
          result.before = clone(current);
          const requiredExpected = ['start', 'end', 'text', 'speaker', 'keep', 'voice_type'];
          const missingExpected = requiredExpected.filter(key => operation.expected?.[key] === undefined);
          if (missingExpected.length) result.errors.push(`expected必須項目が不足しています: ${missingExpected.join(', ')}`);
          result.expected_mismatches = expectedMatches(current, operation.expected);
          if (result.expected_mismatches.length) result.errors.push('expectedが現在値と一致しません');
          if (current.keep !== '保留') result.errors.push('初期安全版のsplit_regionは保留regionだけを対象にできます');
          if (String(current.speaker ?? '') !== '1' || String(current.voice_type ?? '') !== '说话') {
            result.errors.push('native splitの新規partはspeaker=1 / keep=保留 / voice_type=说话で生成されます。元小条の話者または人声类型が異なる場合は自動分割しません');
          }
          if (!Array.isArray(operation.parts) || operation.parts.length !== 2) {
            result.errors.push('split_regionのpartsは初期安全版では2件ちょうど必要です');
          } else {
            const allowedPartKeys = new Set(['start', 'end', 'text']);
            const parts = operation.parts.map((part, index) => {
              if (!part || typeof part !== 'object' || Array.isArray(part)) {
                result.errors.push(`parts[${index}]はオブジェクトである必要があります`);
                return null;
              }
              const extra = Object.keys(part).filter(key => !allowedPartKeys.has(key));
              if (extra.length) result.errors.push(`parts[${index}]に変更不可フィールドがあります: ${extra.join(', ')}`);
              const start = numberOrNull(part.start);
              const end = numberOrNull(part.end);
              if (start == null || end == null) result.errors.push(`parts[${index}]のstart/endは有限数である必要があります`);
              if (part.text === undefined) result.errors.push(`parts[${index}]のtextがありません`);
              else if (!normalizeText(part.text).trim()) result.errors.push(`parts[${index}]のtextを空にできません`);
              return {
                ...clone(current),
                region_id: index === 0 ? current.region_id : makeStructuralPlaceholderId(operation, index, usedRegionIds),
                start: round6(start),
                end: round6(end),
                duration: start != null && end != null ? round6(end - start) : null,
                text: normalizeText(part.text),
                speaker: index === 0 ? current.speaker : '1',
                keep: index === 0 ? current.keep : '保留',
                voice_type: index === 0 ? current.voice_type : '说话',
                quality: index === 0 ? current.quality : '无问题',
                round_id: index === 0 ? current.round_id : null,
                structural_placeholder: index !== 0
              };
            }).filter(Boolean);
            if (parts.length === 2) {
              const [first, second] = parts;
              if (Math.abs(first.start - current.start) > EPS) result.errors.push('split_regionの先頭part.startは元region.startと一致する必要があります');
              if (Math.abs(second.end - current.end) > EPS) result.errors.push('split_regionの末尾part.endは元region.endと一致する必要があります');
              if (first.end > second.start + EPS) result.errors.push('split_regionのparts同士を重複させることはできません');
              if (first.end <= first.start || second.end <= second.start) result.errors.push('split_regionの各partはend > startである必要があります');
              if (first.end > current.end + EPS || second.start < current.start - EPS) result.errors.push('split_regionのpartsは元region範囲内である必要があります');
              result.after = clone(parts);
              result.changes = [{ field: 'split', before: clone(current), after: clone(parts) }];
              if (!result.errors.length) {
                const index = simulated.findIndex(region => region.region_id === operation.region_id);
                if (index >= 0) simulated.splice(index, 1, ...parts);
                sortAndRenumber(simulated);
                map.clear();
                for (const region of simulated) map.set(region.region_id, region);
                result.after = clone(parts.map(part => map.get(part.region_id)));
                result.changes = [{ field: 'split', before: clone(current), after: clone(result.after) }];
              }
            }
          }
        }
        if (!approvedStructuralOpIds.has(operation.op_id)) {
          result.review_required.push('split_regionはユーザーの個別承認が必要です');
        }
      } else if (operation.type === 'add_region') {
        if (operation.region_id) result.errors.push('add_regionにregion_idを指定できません。正式IDはAIDP自身が適用時に生成します');
        const source = operation.region;
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
          result.errors.push('add_regionのregionがありません');
        } else {
          const allowedKeys = new Set(['start', 'end', 'text', 'speaker', 'keep', 'voice_type']);
          const extra = Object.keys(source).filter(key => !allowedKeys.has(key));
          if (extra.length) result.errors.push(`add_regionに指定できないフィールドがあります: ${extra.join(', ')}`);
          const required = ['start', 'end', 'text'];
          const missing = required.filter(key => source[key] === undefined);
          if (missing.length) result.errors.push(`add_regionの必須項目が不足しています: ${missing.join(', ')}`);
          if (!normalizeText(source.text).trim()) result.errors.push('add_regionのtextを空にできません');
          const requestedSpeaker = String(source.speaker ?? '1');
          const requestedKeep = String(source.keep ?? '保留');
          const requestedVoiceType = String(source.voice_type ?? '说话');
          if (requestedSpeaker !== '1' || requestedKeep !== '保留' || requestedVoiceType !== '说话') {
            result.errors.push('AIDP native addの初期値はspeaker=1 / keep=保留 / voice_type=说话です。話者・保留/丢弃・人声类型の自動変更は行いません');
          }
          const start = numberOrNull(source.start);
          const end = numberOrNull(source.end);
          if (start == null || end == null) result.errors.push('add_regionのstart/endは有限数である必要があります');
          if (start != null && end != null && end <= start) result.errors.push('add_regionはend > startである必要があります');
          const created = {
            region_id: makeStructuralPlaceholderId(operation, 0, usedRegionIds),
            start: round6(start),
            end: round6(end),
            duration: start != null && end != null ? round6(end - start) : null,
            text: normalizeText(source.text),
            speaker: String(source.speaker ?? '1'),
            speaker_desc: null,
            keep: String(source.keep ?? '保留'),
            voice_type: String(source.voice_type ?? '说话'),
            quality: '无问题',
            round_id: null,
            table: null,
            source_alignment: { model_present: false, wave_present: false, table_present: false },
            structural_placeholder: true
          };
          result.after = clone(created);
          result.changes = [{ field: 'add', before: null, after: clone(created) }];
          if (!result.errors.length) {
            simulated.push(created);
            sortAndRenumber(simulated);
            map.clear();
            for (const region of simulated) map.set(region.region_id, region);
            result.after = clone(map.get(created.region_id));
            result.changes = [{ field: 'add', before: null, after: clone(result.after) }];
          }
        }
        if (!approvedStructuralOpIds.has(operation.op_id)) {
          result.review_required.push('add_regionはユーザーの個別承認が必要です');
        }
      } else if (operation.type === 'delete_region') {
        const current = map.get(operation.region_id);
        if (!operation.region_id) result.errors.push('region_idがありません');
        if (!current) result.errors.push(`region_idが現在案件に存在しません: ${operation.region_id}`);
        if (current) {
          result.before = clone(current);
          const requiredExpected = ['start', 'end', 'text', 'speaker', 'keep', 'voice_type'];
          const missingExpected = requiredExpected.filter(key => operation.expected?.[key] === undefined);
          if (missingExpected.length) result.errors.push(`expected必須項目が不足しています: ${missingExpected.join(', ')}`);
          result.expected_mismatches = expectedMatches(current, operation.expected);
          if (result.expected_mismatches.length) result.errors.push('expectedが現在値と一致しません');
          if (simulated.length <= 1) result.errors.push('最後の1件は削除できません');
          if (!result.errors.length) {
            const index = simulated.findIndex(region => region.region_id === operation.region_id);
            if (index >= 0) simulated.splice(index, 1);
            sortAndRenumber(simulated);
            map.clear();
            for (const region of simulated) map.set(region.region_id, region);
            result.after = null;
            result.changes = [{ field: 'delete', before: clone(current), after: null }];
          }
        }
        if (!approvedStructuralOpIds.has(operation.op_id)) {
          result.review_required.push('delete_regionはユーザーの個別承認が必要です');
        }
      }

      if (operation.requires_user_review && !approvedStructuralOpIds.has(operation.op_id)) {
        result.review_required.push('requires_user_review=true のため、このbetaでは自動適用対象外です');
      }
      if (!result.errors.length) {
        result.expected_regions_after = canonicalSimulation(simulated);
        result.status = result.review_required.length ? 'review_required' : 'applicable';
      }
      operationResults.push(result);
    }

    const platformDuration = Number(snapshot.caseData.duration_sources?.platform_wave_sec);
    const baselineGeometry = validateRegionGeometry(snapshot.regionsData.regions, platformDuration, snapshot.ruleset);
    const geometry = validateRegionGeometry(simulated, platformDuration, snapshot.ruleset);
    const findingKey = text => {
      const value = String(text || '');
      const prefix = value.split(':')[0];
      if (value.includes('end=') && value.includes('波形長')) return `${prefix}:out_of_range`;
      if (value.includes('startが0未満')) return `${prefix}:start_negative`;
      if (value.includes('endはstartより後')) return `${prefix}:invalid_interval`;
      if (value.includes('start/endが数値')) return `${prefix}:invalid_number`;
      if (value.includes('10秒超')) return `${prefix}:duration_over`;
      if (value.includes('同一話者') && value.includes('重複')) return `${prefix}:same_speaker_overlap`;
      if (value.includes('重複')) return `${prefix}:overlap_review`;
      return value;
    };
    const baselineErrors = new Set(baselineGeometry.errors.map(findingKey));
    for (const error of geometry.errors) {
      if (!baselineErrors.has(findingKey(error))) errors.push(`修正により新しい構造エラーが発生します: ${error}`);
      else warnings.push(`既存の構造エラー（今回の変更前から存在）: ${error}`);
    }
    const baselineWarnings = new Set(baselineGeometry.warnings.map(findingKey));
    const baselineReview = new Set(baselineGeometry.review.map(findingKey));
    for (const warning of geometry.warnings) {
      if (!baselineWarnings.has(findingKey(warning))) errors.push(`修正により新しいルール違反が発生します: ${warning}`);
      else warnings.push(warning);
    }
    for (const item of geometry.review) {
      if (!baselineReview.has(findingKey(item))) errors.push(`修正により新しい重複・要確認状態が発生します: ${item}`);
      else reviewRequired.push(item);
    }

    const operationErrorCount = operationResults.reduce((sum, item) => sum + item.errors.length, 0);
    const applicableCount = operationResults.filter(item => item.status === 'applicable').length;
    const reviewCount = operationResults.filter(item => item.status === 'review_required').length;
    const rejectedCount = operationResults.filter(item => item.status === 'rejected').length;
    const applicable = errors.length === 0 && operationErrorCount === 0 && rejectedCount === 0 && reviewCount === 0 && applicableCount === operationResults.length && applicableCount > 0;

    return {
      schema: 'aidp-patch-dry-run/v3',
      generated_at: new Date().toISOString(),
      applicable,
      patch,
      case_key: snapshot.caseData.case_key,
      source_snapshot_id: snapshot.caseData.snapshot_id,
      source_fingerprint: snapshot.caseData.source_fingerprint,
      counts: {
        total: operationResults.length,
        applicable: applicableCount,
        review_required: reviewCount,
        rejected: rejectedCount
      },
      errors,
      warnings,
      review_required: reviewRequired,
      operations: operationResults,
      simulated_regions: simulated,
      simulated_fingerprint_payload: canonicalSimulation(simulated),
      patch_stable_json: stableStringify(patch)
    };
  }

  globalThis.AIDPPatchEngine = {
    normalizePatch,
    stableStringify,
    expectedMatches,
    diffFields,
    isStructuralPlaceholderId,
    dryRun
  };
})();
