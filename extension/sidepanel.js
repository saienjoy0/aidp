(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const connectionBadge = $('connection-badge');
  const statusText = $('status-text');
  const progress = $('progress');
  const spinner = $('busy-spinner');
  const exportButton = $('export-button');
  const inspectButton = $('inspect-button');
  const dryRunButton = $('dry-run-button');
  const clearPatchButton = $('clear-patch-button');
  const patchFile = $('patch-file');
  const patchText = $('patch-text');
  const patchPreview = $('patch-preview');
  const patchSummary = $('patch-summary');
  const operationList = $('operation-list');
  const structuralApproval = $('structural-approval');
  const structuralApprovalList = $('structural-approval-list');
  const structuralApproveButton = $('structural-approve-button');
  const applyButton = $('apply-button');
  const applyReadySummary = $('apply-ready-summary');
  const confirmPersistenceButton = $('confirm-persistence-button');
  const rollbackButton = $('rollback-button');
  const journalStatus = $('journal-status');
  const summaryCard = $('summary-card');
  const summaryList = $('summary-list');
  const issueList = $('issue-list');

  const EXPORT_PORT_NAME = 'AIDP_EXPORT_JOB_V1';
  const MUTATION_PORT_NAME = 'AIDP_MUTATION_JOB_V1';
  const HEARTBEAT_MS = 15000;
  let busy = false;
  let currentDryRun = null;

  function createJobId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function runPortJob(portName, startMessage, timeoutMs) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: portName });
      let settled = false;
      let heartbeat = null;
      let timeout = null;
      const jobId = startMessage.job_id;
      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
        try { port.disconnect(); } catch (_) {}
      };
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      port.onMessage.addListener(message => {
        if (!message || typeof message !== 'object') return;
        if (message.job_id && message.job_id !== jobId) return;
        if (['AIDP_EXPORT_PROGRESS', 'AIDP_MUTATION_PROGRESS'].includes(message.type)) {
          setStatus(message.text || '処理中…', Number(message.percent));
        } else if (message.type === 'RESULT') done(resolve, message.result);
        else if (message.type === 'ERROR') done(reject, new Error(message.error || '処理に失敗しました'));
      });
      port.onDisconnect.addListener(() => {
        if (settled) return;
        done(reject, new Error(chrome.runtime.lastError?.message || '処理用Portが切断されました'));
      });
      heartbeat = setInterval(() => {
        try { port.postMessage({ type: 'PING', job_id: jobId, at: Date.now() }); }
        catch (error) { done(reject, error); }
      }, HEARTBEAT_MS);
      timeout = setTimeout(() => done(reject, new Error('処理が制限時間内に完了しませんでした')), timeoutMs);
      port.postMessage(startMessage);
    });
  }

  function runExportJob(options) {
    const jobId = createJobId('export');
    return runPortJob(EXPORT_PORT_NAME, { type: 'START_EXPORT', job_id: jobId, options }, 20 * 60 * 1000);
  }

  function runMutationJob(action, extra = {}) {
    const jobId = createJobId(action);
    return runPortJob(MUTATION_PORT_NAME, { type: 'START_MUTATION', job_id: jobId, action, ...extra }, 12 * 60 * 1000);
  }

  function setBusy(value) {
    busy = value;
    for (const button of [exportButton, inspectButton, dryRunButton, clearPatchButton, confirmPersistenceButton, rollbackButton]) {
      button.disabled = value;
    }
    spinner.classList.toggle('hidden', !value);
    updateStructuralApprovalEnabled();
    updateApplyEnabled();
  }


  function setStatus(text, percent = null) {
    statusText.textContent = text;
    if (Number.isFinite(percent)) {
      progress.value = Math.max(0, Math.min(100, percent));
      progress.classList.remove('hidden');
    } else progress.classList.add('hidden');
  }

  function setConnection(state, text) {
    connectionBadge.className = `badge ${state}`;
    connectionBadge.textContent = text;
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));
    $(`tab-${name}`)?.classList.add('active');
  }

  function addIssueGroup(kind, title, items) {
    if (!items?.length) return;
    const box = document.createElement('div');
    box.className = `issue-group ${kind}`;
    const h = document.createElement('h3'); h.textContent = title;
    const ul = document.createElement('ul');
    for (const item of items.slice(0, 50)) {
      const li = document.createElement('li');
      li.textContent = typeof item === 'string' ? item : JSON.stringify(item);
      ul.appendChild(li);
    }
    if (items.length > 50) {
      const li = document.createElement('li'); li.textContent = `ほか${items.length - 50}件`;
      ul.appendChild(li);
    }
    box.append(h, ul); issueList.appendChild(box);
  }

  function renderSummary(result) {
    if (!result) return;
    summaryCard.classList.remove('hidden');
    summaryList.textContent = '';
    issueList.textContent = '';
    const decoded = result.duration_sources?.decoded_media_sec;
    const rows = [
      ['案件', result.case_key || '—'],
      ['小条数', String(result.total_region_count ?? '—')],
      ['保留小条', String(result.valid_region_count ?? '—')],
      ['有効時間', Number.isFinite(result.valid_duration) ? `${result.valid_duration.toFixed(3)}秒` : '—'],
      ['AIDP波形長', Number.isFinite(result.duration) ? `${result.duration.toFixed(3)}秒` : '—'],
      ['デコード音声長', Number.isFinite(decoded) ? `${decoded.toFixed(3)}秒` : '未取得'],
      ['Model / Wave / Table', `${result.counts?.model ?? 0} / ${result.counts?.wave ?? 0} / ${result.counts?.table ?? 0}`],
      ['三重照合', result.validation?.triple_match ? '一致' : '不一致・書き込み禁止'],
      ['Fingerprint', result.source_fingerprint || '—']
    ];
    for (const [key, value] of rows) {
      const dt = document.createElement('dt'); dt.textContent = key;
      const dd = document.createElement('dd'); dd.textContent = value;
      summaryList.append(dt, dd);
    }
    const validation = result.validation || {};
    addIssueGroup('error', '構造エラー', validation.errors || []);
    addIssueGroup('warn', '機械警告', validation.rule_warnings || validation.warnings || []);
    addIssueGroup('review', 'ユーザー確認', validation.review_required || []);
    addIssueGroup('info', '参考情報', validation.informational || []);
    addIssueGroup('warn', '媒体範囲', result.media_range_validation?.warnings || []);
    if (!validation.errors?.length && !validation.rule_warnings?.length && !validation.review_required?.length) {
      addIssueGroup('ok', '結果', ['三重照合と機械検査に重大な問題はありません。']);
    }
  }

  function renderDryRun(report) {
    currentDryRun = report;
    patchPreview.classList.remove('hidden');
    patchSummary.textContent = '';
    operationList.textContent = '';
    structuralApproval.classList.add('hidden');
    structuralApprovalList.textContent = '';
    structuralApproveButton.disabled = true;
    const p = document.createElement('p');
    p.className = report.applicable ? 'op-status applicable' : 'op-status rejected';
    p.textContent = report.applicable
      ? `適用可能: ${report.counts.applicable}/${report.counts.total} operation`
      : `適用不可: rejected=${report.counts.rejected}, review=${report.counts.review_required}, errors=${report.errors.length}`;
    patchSummary.appendChild(p);
    if (report.errors?.length || report.warnings?.length || report.review_required?.length) {
      const ul = document.createElement('ul');
      for (const error of report.errors || []) { const li = document.createElement('li'); li.textContent = `エラー: ${error}`; ul.appendChild(li); }
      for (const warning of report.warnings || []) { const li = document.createElement('li'); li.textContent = `警告: ${warning}`; ul.appendChild(li); }
      for (const review of report.review_required || []) { const li = document.createElement('li'); li.textContent = `要確認: ${review}`; ul.appendChild(li); }
      patchSummary.appendChild(ul);
    }
    for (const op of report.operations || []) {
      const box = document.createElement('div'); box.className = 'operation';
      const head = document.createElement('div'); head.className = 'op-head';
      const displayRegionId = op.region_id || op.after?.region_id || '新規';
      const title = document.createElement('span'); title.textContent = `${op.op_id} / ${op.type} / ${displayRegionId}`;
      const status = document.createElement('span'); status.className = `op-status ${op.status}`; status.textContent = op.status;
      head.append(title, status); box.appendChild(head);
      for (const change of op.changes || []) {
        const line = document.createElement('div'); line.className = 'change';
        line.textContent = `${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`;
        box.appendChild(line);
      }
      if (op.reason) { const line = document.createElement('div'); line.className = 'change muted'; line.textContent = `理由: ${op.reason}`; box.appendChild(line); }
      for (const error of op.errors || []) { const line = document.createElement('div'); line.className = 'change op-status rejected'; line.textContent = `エラー: ${error}`; box.appendChild(line); }
      operationList.appendChild(box);
    }
    const structuralOps = (report.operations || []).filter(op =>
      ['split_region', 'add_region', 'delete_region'].includes(op.type) && op.status === 'review_required' && !(op.errors || []).length
    );
    if (structuralOps.length) {
      structuralApproval.classList.remove('hidden');
      for (const op of structuralOps) {
        const label = document.createElement('label');
        label.className = 'option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.structuralOpId = op.op_id;
        const text = document.createElement('span');
        text.textContent = `${op.op_id} / ${op.type} / ${op.region_id || (op.after?.region_id?.startsWith?.('__aidp_bridge_native__') ? '正式IDはAIDPが適用時生成' : op.after?.region_id) || '新規'}`;
        label.append(checkbox, text);
        structuralApprovalList.appendChild(label);
      }
      structuralApprovalList.querySelectorAll('input[type="checkbox"]').forEach(box => {
        box.addEventListener('change', updateStructuralApprovalEnabled);
      });
      }
    if (report.applicable) {
      const count = report.counts?.applicable ?? 0;
      applyReadySummary.textContent = `${count}件の変更がdry-run済みです。下のボタン1回で適用します。`;
      applyButton.textContent = `${count}件をAIDPへ適用`;
    } else {
      applyReadySummary.textContent = '適用できない項目があります。修正JSONまたは現在案件を確認してください。';
      applyButton.textContent = '検査済み修正をAIDPへ適用';
    }
    updateApplyEnabled();
  }

  function updateStructuralApprovalEnabled() {
    const boxes = [...structuralApprovalList.querySelectorAll('input[type="checkbox"]')];
    structuralApproveButton.disabled = busy || !boxes.length || boxes.some(box => !box.checked);
  }

  async function approveStructuralChanges() {
    if (busy || structuralApproveButton.disabled || !currentDryRun?.dry_run_token) return;
    const opIds = [...structuralApprovalList.querySelectorAll('input[type="checkbox"]:checked')]
      .map(box => box.dataset.structuralOpId)
      .filter(Boolean);
    setBusy(true);
    setStatus('構造変更の個別承認を反映して再dry-runしています…', 20);
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'AIDP_APPROVE_STRUCTURAL_DRY_RUN',
        token: currentDryRun.dry_run_token,
        op_ids: opIds
      });
      if (!result?.ok) throw new Error(result?.error || '構造変更の承認に失敗しました');
      renderDryRun(result.report);
      switchTab(result.report.applicable ? 'apply' : 'import');
      setStatus(result.report.applicable
        ? '構造変更を個別承認しました。最終差分を確認してから適用してください。'
        : '承認後dry-runに適用不可項目があります。', 100);
    } catch (error) {
      setStatus(`構造変更の承認失敗: ${error?.message || String(error)}`);
    } finally {
      setBusy(false);
      await refreshJournal();
    }
  }

  function updateApplyEnabled() {
    applyButton.disabled = busy || !currentDryRun?.applicable || !currentDryRun?.dry_run_token;
  }

  async function refreshConnection() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'AIDP_GET_ACTIVE_STATUS' });
      if (result?.ok) {
        setConnection('ok', `AIDP接続 ${result.version || ''}`.trim());
        setStatus('現在案件を読み取れます。');
      } else {
        setConnection('warn', '対象外タブ');
        setStatus(result?.error || 'AIDP案件画面を開いてください。');
      }
    } catch (error) {
      setConnection('error', '接続失敗');
      setStatus(error?.message || String(error));
    }
    await refreshJournal();
  }

  async function refreshJournal() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'AIDP_GET_JOURNAL_STATUS' });
      const journal = result?.journal;
      if (!journal) {
        journalStatus.textContent = 'この案件に未完了journalはありません。';
        confirmPersistenceButton.disabled = true;
        rollbackButton.disabled = true;
        return;
      }
      const statusLabels = {
        applying: '前回の適用処理が中断・確認待ち（復元ボタンで安全解除可能）',
        rolling_back: '復元処理中',
        apply_failed_compensating: '適用失敗後の補償復元中',
        rolled_back_after_failure: '適用失敗後に自動復元済み（現在は適用前状態）',
        applied_pending_persistence: '適用済み・再読み込み確認待ち',
        applied_pending_verification: '適用操作済み・AIDP内部反映の確定待ち',
        confirmed: '適用・再読み込み確認済み',
        recovery_required: '復元にユーザー確認が必要',
        persistence_mismatch: '再読み込み後の状態が不一致',
        not_applied: '変更未反映として終了済み（次のdry-run・適用可）',
        rolled_back: '適用前状態へ復元済み'
      };
      const label = statusLabels[journal.status] || journal.status;
      const errorLine = journal.apply_error ? `\n原因: ${journal.apply_error}` : '';
      journalStatus.textContent = `${label}\nID: ${journal.journal_id}\n更新: ${journal.updated_at || journal.created_at}${errorLine}`;
      confirmPersistenceButton.disabled = busy || !['applied_pending_persistence', 'applied_pending_verification'].includes(journal.status);
      rollbackButton.disabled = busy || !['applying', 'apply_failed_compensating', 'rolling_back', 'applied_pending_persistence', 'applied_pending_verification', 'persistence_mismatch', 'recovery_required', 'confirmed'].includes(journal.status);
    } catch (error) {
      journalStatus.textContent = `journal取得失敗: ${error?.message || String(error)}`;
    }
  }

  async function runInspection() {
    if (busy) return;
    setBusy(true); setStatus('全ページ・Neeko Model・Wave・rulesetを取得しています…', 5);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'AIDP_RUN_INSPECTION' });
      if (!result?.ok) throw new Error(result?.error || '検査に失敗しました');
      renderSummary(result.summary);
      setStatus('検査完了。AIDPは変更していません。', 100);
    } catch (error) { setStatus(`検査失敗: ${error?.message || String(error)}`); }
    finally { setBusy(false); await refreshJournal(); }
  }

  async function runExport() {
    if (busy) return;
    setBusy(true); summaryCard.classList.add('hidden'); setStatus('案件ZIPを準備しています…', 2);
    try {
      const result = await runExportJob({
        includeAudio: $('include-audio').checked,
        includeWaveform: $('include-waveform').checked,
        allowJsonFallback: $('json-fallback').checked
      });
      if (!result?.ok) throw new Error(result?.error || 'ZIP書き出しに失敗しました');
      renderSummary(result.summary);
      setStatus(`ZIP保存を開始しました: ${result.filename}${result.partial ? '\n音声は部分失敗です。diagnosticsを確認してください。' : ''}`, 100);
    } catch (error) { setStatus(`書き出し失敗: ${error?.message || String(error)}`); }
    finally { setBusy(false); }
  }

  async function runDryRun() {
    if (busy) return;
    setBusy(true); setStatus('修正JSONと現在案件を照合しています…', 10);
    try {
      const patch = JSON.parse(patchText.value);
      const result = await chrome.runtime.sendMessage({ type: 'AIDP_PATCH_DRY_RUN', patch });
      if (!result?.ok) throw new Error(result?.error || 'dry-runに失敗しました');
      renderDryRun(result.report);
      switchTab(result.report.applicable ? 'apply' : 'import');
      setStatus(result.report.applicable ? 'dry-run完了。差分を確認後、適用ボタンを1回押してください。' : 'dry-run完了。エラーを修正してください。', 100);
    } catch (error) {
      currentDryRun = null; patchPreview.classList.add('hidden'); updateApplyEnabled();
      setStatus(`dry-run失敗: ${error?.message || String(error)}`);
    } finally { setBusy(false); await refreshJournal(); }
  }

  async function runApply() {
    if (busy || applyButton.disabled) return;
    setBusy(true); setStatus('適用前backupを作成しています…', 3);
    try {
      const report = await runMutationJob('apply', { token: currentDryRun.dry_run_token });
      if (report.status === 'applied_pending_verification') {
        setStatus(`適用操作は完了しましたが、AIDP内部状態の確定待ちです。
AIDPを手動で再読み込みした後、「手動再読み込み後：45秒待って保持確認」を実行してください。`, 100);
        applyReadySummary.textContent = '反映確定待ちです。再読み込み確認で最終判定します。';
      } else {
        setStatus(`適用完了: ${report.operation_count}件。次にAIDPを手動で再読み込みした後、「手動再読み込み後：45秒待って保持確認」を実行してください。`, 100);
        applyReadySummary.textContent = '適用済みです。次は再読み込み確認を実行してください。';
      }
      currentDryRun = null;
      applyButton.textContent = '検査済み修正をAIDPへ適用';
      updateApplyEnabled();
    } catch (error) { setStatus(`適用失敗: ${error?.message || String(error)}
「適用レポート」から失敗診断を保存できます。`); }
    finally { setBusy(false); await refreshJournal(); }
  }


  async function runConfirmPersistence() {
    if (busy) return;
    setBusy(true); setStatus('自動リロードは行いません。45秒間は検査せず、その後ページ固有IDで手動再読み込みを確認します…', 3);
    try {
      const report = await runMutationJob('confirm_persistence');
      if (report.confirmed) {
        setStatus('永続化確認PASS。AIDP上で最終確認してください。提出は自動化していません。', 100);
      } else if (report.reverted_to_backup) {
        setStatus('再読み込み後は適用前状態でした。変更未反映として処理を終了しました。次のdry-run・適用へ進めます。', 100);
      } else {
        setStatus('永続化確認NG。現在値が適用前・変更後のどちらとも一致しません。', 100);
      }
    } catch (error) { setStatus(`永続化確認失敗: ${error?.message || String(error)}`); }
    finally { setBusy(false); await refreshJournal(); }
  }

  async function runRollback() {
    if (busy) return;
    if (!confirm('適用前backupへ復元します。暫存・提出は操作しません。続行しますか？')) return;
    setBusy(true); setStatus('journalから適用済みoperationを逆順に復元しています…', 3);
    try {
      const report = await runMutationJob('rollback');
      setStatus(report.restored ? '復元PASS。適用前fingerprintへ戻りました。' : `復元要確認: ${report.errors?.join(' / ') || ''}`, 100);
    } catch (error) { setStatus(`復元失敗: ${error?.message || String(error)}`); }
    finally { setBusy(false); await refreshJournal(); }
  }

  async function downloadReport(kind) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'AIDP_DOWNLOAD_LAST_REPORT', kind });
      if (!result?.ok) throw new Error(result?.error || 'レポート保存に失敗しました');
      setStatus(`レポート保存を開始しました: ${result.result.filename}`);
    } catch (error) { setStatus(`レポート保存失敗: ${error?.message || String(error)}`); }
  }

  patchFile.addEventListener('change', async () => {
    const file = patchFile.files?.[0];
    if (!file) return;
    try { patchText.value = await file.text(); setStatus(`修正JSONを読み込みました: ${file.name}`); }
    catch (error) { setStatus(`JSON読込失敗: ${error?.message || String(error)}`); }
  });
  clearPatchButton.addEventListener('click', () => {
    patchText.value = ''; patchFile.value = ''; currentDryRun = null; patchPreview.classList.add('hidden');
    applyReadySummary.textContent = '修正JSONをdry-runすると、ここから1クリックで適用できます。';
    applyButton.textContent = '検査済み修正をAIDPへ適用';
    updateApplyEnabled();
  });
  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  for (const button of document.querySelectorAll('.report-download')) button.addEventListener('click', () => downloadReport(button.dataset.kind));

  exportButton.addEventListener('click', runExport);
  inspectButton.addEventListener('click', runInspection);
  dryRunButton.addEventListener('click', runDryRun);
  structuralApproveButton.addEventListener('click', approveStructuralChanges);
  applyButton.addEventListener('click', runApply);
  confirmPersistenceButton.addEventListener('click', runConfirmPersistence);
  rollbackButton.addEventListener('click', runRollback);
  $('download-dryrun-button').addEventListener('click', () => downloadReport('dry_run'));

  refreshConnection();
})();
