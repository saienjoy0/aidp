(() => {
  'use strict';

  if (window.top !== window) return;
  if (window.__AIDP_BRIDGE_V070_CONTENT__) return;
  window.__AIDP_BRIDGE_V070_CONTENT__ = true;

  const VERSION = '0.7.9-beta.18';
  const PAGE_INSTANCE_ID = globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const DOCUMENT_TIME_ORIGIN_MS = Number(globalThis.performance?.timeOrigin || Date.now());
  const BADGE_ID = 'aidp-chatgpt-bridge-v070-badge';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const round6 = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
  const normalizeText = value => String(value ?? '').replace(/\r\n/g, '\n');

  function installBadge() {
    if (document.getElementById(BADGE_ID)) return;
    const host = document.createElement('div');
    host.id = BADGE_ID;
    host.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483646;font:11px/1.2 system-ui,sans-serif;padding:5px 8px;border-radius:999px;background:#14213d;color:#fff;border:1px solid #4cc9f0;opacity:.86;pointer-events:none;';
    host.textContent = `Bridge ${VERSION}・統合β`;
    document.documentElement.appendChild(host);
  }

  async function exposeReadOnlyDiagnostics() {
    const id = 'aidp-chatgpt-bridge-readonly-diagnostics';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AIDP_GET_MAIN_DIAGNOSTICS' });
      if (!response?.ok) return;
      let host = document.getElementById(id);
      if (!host) {
        host = document.createElement('script');
        host.id = id;
        host.type = 'application/json';
        document.documentElement.appendChild(host);
      }
      host.textContent = JSON.stringify({
        schema: 'aidp-bridge-readonly-diagnostics/v1',
        generated_at: new Date().toISOString(),
        version: VERSION,
        case_key: location.pathname,
        diagnostics: response.diagnostics
      });
    } catch (_) {
      // 読み取り専用診断が取得できなくても通常機能は開始できる。
    }
  }

  function isVisible(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function ensureSafeToNavigate() {
    const active = document.activeElement;
    if (document.hasFocus() && active && /^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName) && isVisible(active)) {
      throw new Error('入力欄が選択中です。編集中の内容を確定または取消してから実行してください');
    }
    const modal = [...document.querySelectorAll('[role="dialog"],.arco-modal-wrapper,.arco-drawer')].find(isVisible);
    if (modal) throw new Error('ダイアログまたはドロワーが開いています。閉じてから実行してください');
  }

  function getTargetTbody() {
    return [...document.querySelectorAll('tbody')].find(tb => tb.querySelector('[class*="region-region_"]')) || null;
  }

  function getRows() {
    const tbody = getTargetTbody();
    return tbody ? [...tbody.querySelectorAll(':scope > tr.arco-table-tr')] : [];
  }

  function getRegionId(row) {
    const marker = [...row.querySelectorAll('[class]')].find(node =>
      [...node.classList].some(name => name.startsWith('region-region_'))
    );
    if (!marker) return '';
    const token = [...marker.classList].find(name => name.startsWith('region-region_'));
    return token ? token.slice('region-'.length) : '';
  }

  function parseClock(text) {
    const value = String(text || '').trim();
    const hms = value.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    const ms = value.match(/(\d+):(\d+(?:\.\d+)?)/);
    if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
    return NaN;
  }

  function findTimeLabel(row, prefix) {
    const values = [...row.querySelectorAll('span,div')]
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);
    return values.find(text => text.startsWith(prefix)) || '';
  }

  function checkedLabelText(row, choices) {
    for (const label of row.querySelectorAll('label')) {
      const text = label.textContent.trim();
      if (!choices.includes(text)) continue;
      if (label.classList.contains('arco-radio-checked') || label.querySelector('input:checked')) return text;
    }
    return '';
  }

  function speakerData(row) {
    const values = [];
    const add = raw => {
      const value = String(raw || '').trim();
      if (!value || value === '1倍速' || values.includes(value)) return;
      values.push(value);
    };

    for (const view of row.querySelectorAll('.arco-select-view')) {
      const tagValues = [...view.querySelectorAll('.arco-tag-content,.arco-select-view-tag')]
        .map(el => el.textContent?.trim()).filter(Boolean);
      if (tagValues.length) tagValues.forEach(add);
      else {
        add(view.getAttribute('title'));
        add(view.querySelector('.arco-select-view-value')?.textContent);
      }
    }

    // 話者番号に見えない候補を除外する。カスタム表示はそのまま保持する。
    const filtered = values.filter(value => /(?:^unk$|\d|重叠|異口|同声|同一|：|:)/i.test(value));
    return {
      display: filtered.join(' / '),
      values: filtered
    };
  }

  function parseRow(row, pageNo, rowIndex) {
    const regionId = getRegionId(row);
    if (!regionId) return null;
    const textarea = row.querySelector('textarea.neeko-input-textarea');
    const numberText =
      row.querySelector(`.region-${CSS.escape(regionId)} .neeko-text`)?.textContent?.trim() ||
      row.querySelector('td:first-child .neeko-text')?.textContent?.trim() || '';
    const speaker = speakerData(row);

    return {
      region_id: regionId,
      page: pageNo,
      row_in_page: rowIndex + 1,
      display_number: Number(numberText) || null,
      start: round6(parseClock(findTimeLabel(row, '起：'))),
      end: round6(parseClock(findTimeLabel(row, '终：'))),
      text: normalizeText(textarea?.value || ''),
      keep: checkedLabelText(row, ['保留', '丢弃']),
      voice_type: checkedLabelText(row, ['说话', '歌词']),
      speaker: speaker.display,
      speaker_values: speaker.values
    };
  }

  function getCurrentPage() {
    const active = document.querySelector('.arco-pagination-item-active[aria-label^="第 "]');
    const match = active?.getAttribute('aria-label')?.match(/第\s*(\d+)\s*页/);
    return match ? Number(match[1]) : 1;
  }

  function getTotalCount() {
    const text = document.querySelector('.arco-pagination-total-text')?.textContent || '';
    const match = text.match(/共\s*(\d+)\s*条/);
    return match ? Number(match[1]) : getRows().length;
  }

  function detectSpeakerFilter() {
    const candidates = [...document.querySelectorAll('input[placeholder="请选择"]')]
      .filter(isVisible)
      .map(input => {
        const select = input.closest('.arco-select-view') || input.parentElement;
        const tags = select ? [...select.querySelectorAll('.arco-tag-content,.arco-select-view-tag')]
          .map(el => el.textContent?.trim() || '').filter(Boolean) : [];
        const value = String(input.value || '').trim();
        return { value, tags };
      });
    const selectedValues = candidates.flatMap(item => [item.value, ...item.tags]).filter(Boolean);
    return {
      detected: candidates.length > 0,
      active: selectedValues.length > 0,
      selected_values: [...new Set(selectedValues)]
    };
  }

  function paginationButton(direction) {
    const label = direction === 'next' ? '下一页' : '上一页';
    return document.querySelector(`[aria-label="${label}"]`);
  }

  function isDisabled(el) {
    return !el || el.disabled || el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('arco-pagination-item-disabled') ||
      el.closest('.arco-pagination-item-disabled');
  }

  function firstRowId() {
    return getRegionId(getRows()[0]);
  }

  async function waitForPage(targetPage, previousFirstId = '', timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let stable = 0;
    let lastSignature = '';
    while (Date.now() < deadline) {
      const rows = getRows();
      const signature = rows.map(getRegionId).join('|');
      const pageOk = getCurrentPage() === targetPage;
      const contentOk = rows.length > 0 && (!previousFirstId || getRegionId(rows[0]) !== previousFirstId || targetPage === 1);
      if (pageOk && contentOk && signature === lastSignature) stable += 1;
      else stable = 0;
      if (stable >= 2) return;
      lastSignature = signature;
      await sleep(120);
    }
    throw new Error(`第${targetPage}ページの読み込みが安定しませんでした`);
  }

  async function stepPage(direction) {
    const current = getCurrentPage();
    const button = paginationButton(direction);
    if (isDisabled(button)) return false;
    const beforeId = firstRowId();
    const target = direction === 'next' ? current + 1 : current - 1;
    button.click();
    await waitForPage(target, beforeId);
    return true;
  }

  async function goToPageBySteps(targetPage) {
    let guard = 0;
    while (getCurrentPage() !== targetPage) {
      if (++guard > 1000) throw new Error('ページ復元の上限を超えました');
      const direction = getCurrentPage() < targetPage ? 'next' : 'prev';
      const moved = await stepPage(direction);
      if (!moved) throw new Error(`第${targetPage}ページへ移動できませんでした`);
    }
  }

  function detectMediaUrl() {
    const direct = [...document.querySelectorAll('video,audio,source')]
      .map(el => el.currentSrc || el.src || el.getAttribute('src'))
      .find(Boolean);
    if (direct) return direct;
    try {
      return performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .find(name => /\.(?:mp4|m4a|mp3|wav)(?:$|\?)/i.test(name)) || '';
    } catch (_) {
      return '';
    }
  }

  function pageStructureSummary() {
    const rows = getRows();
    const tbody = getTargetTbody();
    return {
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      visibility_state: document.visibilityState,
      has_focus: document.hasFocus(),
      target_tbody_count: [...document.querySelectorAll('tbody')]
        .filter(tb => tb.querySelector('[class*="region-region_"]')).length,
      visible_rows: rows.length,
      region_markers: tbody?.querySelectorAll('[class*="region-region_"]').length || 0,
      table_subtitle_textareas: rows.reduce((sum, row) => sum + row.querySelectorAll('textarea.neeko-input-textarea').length, 0),
      all_textareas: document.querySelectorAll('textarea').length,
      pagination_found: Boolean(document.querySelector('.arco-pagination')),
      total_count_display: getTotalCount(),
      speaker_filter: detectSpeakerFilter(),
      media_url_found: Boolean(detectMediaUrl())
    };
  }

  async function collectAllTablePages() {
    ensureSafeToNavigate();
    const speakerFilter = detectSpeakerFilter();
    if (speakerFilter.active) {
      throw new Error(`話者フィルター表示中は全件取得できません。フィルターを解除してください（選択=${speakerFilter.selected_values.join(' / ')})`);
    }
    const originalPage = getCurrentPage();
    const totalExpected = getTotalCount();
    const regions = [];
    const pageCounts = [];
    let restoreError = '';

    if (!getRows().length) throw new Error('小条テーブルが見つかりません');
    if (totalExpected < 1) throw new Error('小条総数を取得できません');

    try {
      await goToPageBySteps(1);
      let pageNo = 1;
      let firstPageSize = null;
      const maxPages = Math.max(1, totalExpected + 2);

      while (pageNo <= maxPages) {
        const currentTotal = getTotalCount();
        if (currentTotal !== totalExpected) {
          throw new Error(`ページ巡回中に小条総数が変化しました（開始時${totalExpected}件 / 現在${currentTotal}件）`);
        }
        const rows = getRows();
        if (!rows.length) throw new Error(`第${pageNo}ページに小条がありません`);
        const parsed = rows.map((row, index) => parseRow(row, pageNo, index));
        if (parsed.some(item => !item || !item.region_id || !Number.isFinite(item.start) || !Number.isFinite(item.end))) {
          throw new Error(`第${pageNo}ページの行構造が想定外です`);
        }
        if (firstPageSize == null) firstPageSize = parsed.length;
        pageCounts.push({ page: pageNo, count: parsed.length });
        regions.push(...parsed);

        if (regions.length >= totalExpected) break;
        const moved = await stepPage('next');
        if (!moved) break;
        pageNo += 1;
      }

      if (regions.length !== totalExpected) {
        throw new Error(`全件数不一致: 画面表示${totalExpected}件 / 取得${regions.length}件`);
      }
      const finalTotal = getTotalCount();
      if (finalTotal !== totalExpected) {
        throw new Error(`ページ巡回完了時に小条総数が変化しました（開始時${totalExpected}件 / 完了時${finalTotal}件）`);
      }
      const ids = regions.map(item => item.region_id);
      if (new Set(ids).size !== ids.length) throw new Error('region_idが重複しています');
      for (const page of pageCounts.slice(0, -1)) {
        if (page.count !== firstPageSize) {
          throw new Error(`途中ページの件数が不規則です（第${page.page}ページ=${page.count}件）`);
        }
      }
      const last = pageCounts[pageCounts.length - 1];
      if (last.count > firstPageSize) throw new Error('最終ページ件数がページサイズを超えています');
    } finally {
      try { await goToPageBySteps(originalPage); }
      catch (error) { restoreError = error?.message || String(error); }
    }

    return {
      schema: 'aidp-table-snapshot/v2',
      generated_at: new Date().toISOString(),
      case_key: location.pathname,
      href: location.href,
      title: document.title,
      document_language: document.documentElement.lang || navigator.language || '',
      original_page: originalPage,
      restored_page: getCurrentPage(),
      restore_error: restoreError,
      total_count: totalExpected,
      page_counts: pageCounts,
      media_url: detectMediaUrl(),
      structure: pageStructureSummary(),
      regions
    };
  }


  function findRowByRegionId(regionId) {
    return getRows().find(row => getRegionId(row) === String(regionId || '')) || null;
  }

  async function locateRegionRow(regionId, preferredPage = null) {
    const targetId = String(regionId || '');
    if (!targetId) throw new Error('region_idがありません');
    const totalExpected = getTotalCount();
    const maxPages = Math.max(1, Math.ceil(totalExpected / Math.max(1, getRows().length || 10)) + 3);

    if (Number.isFinite(Number(preferredPage)) && Number(preferredPage) >= 1) {
      await goToPageBySteps(Number(preferredPage));
      const row = findRowByRegionId(targetId);
      if (row) return { row, page: getCurrentPage() };
    }

    await goToPageBySteps(1);
    for (let page = 1; page <= maxPages; page += 1) {
      const row = findRowByRegionId(targetId);
      if (row) return { row, page: getCurrentPage() };
      const moved = await stepPage('next');
      if (!moved) break;
    }
    throw new Error(`字幕行が見つかりません: ${targetId}`);
  }

  async function prepareRegionText(payload) {
    ensureSafeToNavigate();
    const originalPage = getCurrentPage();
    const regionId = String(payload?.region_id || '');
    const requested = normalizeText(payload?.text ?? '');
    const expected = payload?.expected_text == null ? null : normalizeText(payload.expected_text);
    const located = await locateRegionRow(regionId, payload?.page);
    const textarea = located.row.querySelector('textarea.neeko-input-textarea');
    if (!textarea) throw new Error(`${regionId}: 字幕textareaが見つかりません`);
    const before = normalizeText(textarea.value);
    if (before !== requested && expected !== null && before !== expected) {
      throw new Error(`${regionId}: 字幕の現在値がexpectedと一致しません（actual=${JSON.stringify(before)}）`);
    }
    return {
      ok: true,
      adapter: 'aidp-row-textarea-react-prepare-v3',
      region_id: regionId,
      original_page: originalPage,
      page: located.page,
      before,
      requested,
      already_applied: before === requested
    };
  }

  async function restoreTablePage(payload) {
    ensureSafeToNavigate();
    const requestedPage = Number(payload?.page);
    if (!Number.isFinite(requestedPage) || requestedPage < 1) {
      throw new Error('復帰先ページが不正です');
    }
    await goToPageBySteps(requestedPage);
    return {
      ok: true,
      adapter: 'aidp-table-page-restore-v1',
      page: getCurrentPage()
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'AIDP_CONTENT_PING') {
      sendResponse({
        ok: true,
        version: VERSION,
        case_key: location.pathname,
        page_instance_id: PAGE_INSTANCE_ID,
        document_time_origin_ms: DOCUMENT_TIME_ORIGIN_MS,
        structure: pageStructureSummary()
      });
      return;
    }

    if (message.type === 'AIDP_PREPARE_REGION_TEXT') {
      (async () => {
        try {
          const result = await prepareRegionText(message.payload || {});
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true;
    }

    if (message.type === 'AIDP_RESTORE_TABLE_PAGE') {
      (async () => {
        try {
          const result = await restoreTablePage(message.payload || {});
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true;
    }

    if (message.type === 'AIDP_COLLECT_TABLE') {
      (async () => {
        try {
          const result = await collectAllTablePages();
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true;
    }
  });

  installBadge();
  setTimeout(exposeReadOnlyDiagnostics, 1500);
})();
