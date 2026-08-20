(() => {
  'use strict';

  const TIME_TOLERANCE = 0.0025;

  const normalizeText = value => String(value ?? '').replace(/\r\n/g, '\n');
  const close = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= TIME_TOLERANCE;
  const idOf = region => String(region?.region_id || region?.id || '');

  function canonical(region) {
    if (!region) return null;
    return {
      region_id: idOf(region),
      start: Number.isFinite(Number(region.start)) ? Number(region.start) : null,
      end: Number.isFinite(Number(region.end)) ? Number(region.end) : null,
      text: normalizeText(region.text ?? region.yuan_text ?? ''),
      speaker: String(region.speaker ?? region.speaker_desc ?? ''),
      keep: String(region.keep ?? region.if_save ?? ''),
      voice_type: String(region.voice_type ?? region.music ?? ''),
      quality: String(region.quality ?? region.is_qualified ?? ''),
      round_id: Number.isFinite(Number(region.round_id)) ? Number(region.round_id) : null
    };
  }

  function coreEquals(aInput, bInput) {
    const a = canonical(aInput);
    const b = canonical(bInput);
    if (!a || !b || !a.region_id || a.region_id !== b.region_id) return false;
    if (!close(a.start, b.start) || !close(a.end, b.end)) return false;
    return ['text', 'speaker', 'keep', 'voice_type', 'quality'].every(key => a[key] === b[key]);
  }

  function createdRegionMatches(aInput, bInput) {
    const a = canonical(aInput);
    const b = canonical(bInput);
    if (!a || !b || !a.region_id || a.region_id !== b.region_id) return false;
    if (!close(a.start, b.start) || !close(a.end, b.end)) return false;
    for (const key of ['speaker', 'keep', 'voice_type', 'quality']) {
      if (a[key] !== b[key]) return false;
    }
    // AIDP has been observed to leave a just-created split region with an empty
    // transcription when a later step fails. Only exact intended text or empty
    // text is considered attributable to this journal. Any other text is treated
    // as a user edit/conflict and must not be deleted automatically.
    return a.text === b.text || a.text === '';
  }

  function toMap(regions) {
    return new Map((Array.isArray(regions) ? regions : []).map(region => {
      const value = canonical(region);
      return [value.region_id, value];
    }).filter(([id]) => id));
  }

  function sameIdSet(aMap, bMap) {
    if (aMap.size !== bMap.size) return false;
    for (const id of aMap.keys()) if (!bMap.has(id)) return false;
    return true;
  }

  function regionListsCoreEqual(aRegions, bRegions) {
    const a = toMap(aRegions);
    const b = toMap(bRegions);
    if (!sameIdSet(a, b)) return false;
    for (const [id, expected] of b) {
      if (!coreEquals(a.get(id), expected)) return false;
    }
    return true;
  }

  function unrelatedStateMatches(currentMap, previousMap, ownedIds, allowedExtraIds = []) {
    const owned = new Set(ownedIds.filter(Boolean));
    const allowedExtra = new Set(allowedExtraIds.filter(Boolean));
    for (const [id, expected] of previousMap) {
      if (owned.has(id)) continue;
      const actual = currentMap.get(id);
      if (!actual || !coreEquals(actual, expected)) {
        return { ok: false, reason: `対象外regionが変更または欠落しています: ${id}` };
      }
    }
    for (const id of currentMap.keys()) {
      if (previousMap.has(id) || owned.has(id) || allowedExtra.has(id)) continue;
      return { ok: false, reason: `journalに属さない未知regionがあります: ${id}` };
    }
    return { ok: true, reason: '' };
  }

  function conflict(reason, details = {}) {
    return { safe: false, already_restored: false, mode: 'conflict', actions: [], reason, details };
  }

  function classifyStep({ currentRegions, previousRegions, operation }) {
    const currentMap = toMap(currentRegions);
    const previousMap = toMap(previousRegions);
    const type = String(operation?.type || '');

    if (regionListsCoreEqual(currentRegions, previousRegions)) {
      return { safe: true, already_restored: true, mode: 'already_restored', actions: [], reason: '現在状態はこのoperation直前状態へ既に戻っています', details: {} };
    }

    if (type === 'update_region' || type === 'set_labels') {
      const id = String(operation?.region_id || operation?.before?.region_id || '');
      if (!id || !previousMap.has(id)) return conflict('更新対象regionを直前状態から特定できません');
      const unrelated = unrelatedStateMatches(currentMap, previousMap, [id]);
      if (!unrelated.ok) return conflict(unrelated.reason);
      const current = currentMap.get(id);
      if (!current) return conflict(`更新対象regionが現在状態にありません: ${id}`);
      if (coreEquals(current, operation.before || previousMap.get(id))) {
        return { safe: true, already_restored: true, mode: 'already_restored', actions: [], reason: '更新対象は既に変更前値です', details: { region_id: id } };
      }
      if (!coreEquals(current, operation.after)) {
        return conflict(`更新対象regionがjournalのbefore/afterのどちらにも一致しません: ${id}`);
      }
      return {
        safe: true,
        already_restored: false,
        mode: 'rollback_update',
        actions: [{ type: 'restore_region', region_id: id, region: canonical(operation.before || previousMap.get(id)) }],
        reason: 'journalの変更後値だけが残っているため変更前値へ戻せます',
        details: { region_id: id }
      };
    }

    if (type === 'add_region') {
      const created = canonical(operation?.after);
      if (!created?.region_id) return conflict('add_regionの作成regionをjournalから特定できません');
      const unrelated = unrelatedStateMatches(currentMap, previousMap, [created.region_id], [created.region_id]);
      if (!unrelated.ok) return conflict(unrelated.reason);
      for (const [id, expected] of previousMap) {
        const actual = currentMap.get(id);
        if (!actual || !coreEquals(actual, expected)) return conflict(`add_region以外の状態が変化しています: ${id}`);
      }
      const liveCreated = currentMap.get(created.region_id);
      if (!liveCreated) {
        return { safe: true, already_restored: true, mode: 'already_restored', actions: [], reason: '追加regionは既に存在しません', details: { created_region_id: created.region_id } };
      }
      if (!createdRegionMatches(liveCreated, created)) {
        return conflict(`追加regionがjournal由来と安全に断定できません: ${created.region_id}`, { actual: liveCreated, expected: created });
      }
      return {
        safe: true,
        already_restored: false,
        mode: 'rollback_add',
        actions: [{ type: 'remove_region', region_id: created.region_id, region: liveCreated }],
        reason: 'journalが作成したregionだけが残っているため削除できます',
        details: { created_region_id: created.region_id }
      };
    }

    if (type === 'delete_region') {
      const deleted = canonical(operation?.before);
      if (!deleted?.region_id || !previousMap.has(deleted.region_id)) return conflict('delete_regionの元regionを直前状態から特定できません');
      const unrelated = unrelatedStateMatches(currentMap, previousMap, [deleted.region_id]);
      if (!unrelated.ok) return conflict(unrelated.reason);
      const live = currentMap.get(deleted.region_id);
      if (live) {
        if (!coreEquals(live, deleted)) return conflict(`削除対象regionが変更されています: ${deleted.region_id}`);
        return { safe: true, already_restored: true, mode: 'already_restored', actions: [], reason: '削除対象regionは既に元の値で存在します', details: { region_id: deleted.region_id } };
      }
      const expectedIdsWithoutDeleted = new Set([...previousMap.keys()].filter(id => id !== deleted.region_id));
      const currentIds = new Set(currentMap.keys());
      if (currentIds.size !== expectedIdsWithoutDeleted.size || [...currentIds].some(id => !expectedIdsWithoutDeleted.has(id))) {
        return conflict('削除以外のID集合変化があり、元regionを安全に再追加できません');
      }
      return {
        safe: true,
        already_restored: false,
        mode: 'rollback_delete',
        actions: [{ type: 'add_region', region_id: deleted.region_id, region: deleted }],
        reason: 'journalによる削除だけが残っているため元regionを再追加できます',
        details: { region_id: deleted.region_id }
      };
    }

    if (type === 'split_region') {
      const before = canonical(operation?.before);
      const parts = Array.isArray(operation?.after) ? operation.after.map(canonical) : [];
      if (!before?.region_id || parts.length !== 2) return conflict('split_regionのbefore/partsをjournalから特定できません');
      const first = parts[0];
      const second = parts[1];
      if (first.region_id !== before.region_id || !second?.region_id) return conflict('split_regionのregion ID関係が不正です');
      const unrelated = unrelatedStateMatches(currentMap, previousMap, [before.region_id, second.region_id], [second.region_id]);
      if (!unrelated.ok) return conflict(unrelated.reason);

      const liveFirst = currentMap.get(before.region_id);
      if (!liveFirst) return conflict(`分割元regionが現在状態にありません: ${before.region_id}`);
      const firstIsBefore = coreEquals(liveFirst, before);
      const firstIsAfter = coreEquals(liveFirst, first);
      if (!firstIsBefore && !firstIsAfter) {
        return conflict(`分割元regionがjournalの分割前/分割後のどちらにも一致しません: ${before.region_id}`);
      }

      const liveSecond = currentMap.get(second.region_id);
      if (liveSecond && !createdRegionMatches(liveSecond, second)) {
        return conflict(`分割で作成されたregionがjournal由来と安全に断定できません: ${second.region_id}`, { actual: liveSecond, expected: second });
      }

      if (!liveSecond && firstIsBefore) {
        return { safe: true, already_restored: true, mode: 'already_restored', actions: [], reason: '分割の追加regionはなく、元regionも変更前状態です', details: {} };
      }
      const actions = [];
      if (liveSecond) actions.push({ type: 'remove_region', region_id: second.region_id, region: liveSecond });
      if (firstIsAfter) actions.push({ type: 'restore_region', region_id: before.region_id, region: before });
      let mode = 'rollback_split_full';
      if (liveSecond && firstIsBefore) mode = 'rollback_split_second_only';
      if (!liveSecond && firstIsAfter) mode = 'rollback_split_first_only';
      return {
        safe: true,
        already_restored: false,
        mode,
        actions,
        reason: liveSecond && liveSecond.text === ''
          ? 'split途中で作成された空字幕regionをjournal由来と確認できたため安全に除去できます'
          : 'splitの部分/完全反映状態をjournalの既知値だけで逆適用できます',
        details: { first_is_before: firstIsBefore, first_is_after: firstIsAfter, second_present: Boolean(liveSecond), second_text_empty: Boolean(liveSecond && liveSecond.text === '') }
      };
    }

    return conflict(`復元分類未対応operation: ${type}`);
  }

  const api = Object.freeze({
    canonical,
    coreEquals,
    createdRegionMatches,
    regionListsCoreEqual,
    classifyStep
  });

  globalThis.AIDPRecoveryEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
