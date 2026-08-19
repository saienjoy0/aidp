# Beta 42 QC One-Click R2 実装報告

2026-08-19

## 修正

- Side Panelをactive AIDP tab優先へ変更。旧pin-firstを廃止。
- Side Panel状態キーを `tabId + stable case identity` へ変更。
- mark-v3で `题目ID` / `Call ID` を案件識別に利用。
- 同一URLでの案件切替を3秒ポーリングで検知。
- export開始時に `case_instance_key` を凍結し、途中案件変更時はSTOP。
- ZIPジョブを `activeExportJobs Map<tabId, job>` へ変更し、タブ別並列書き出しに対応。
- mutation global lockは維持。
- last reportをtab + case単位に分離。
- speaker parserで `BGM` を正式対応。
- QC/返修ワンクリックZIP機能は維持。

## 安全性

- 暫存/提交の自動操作なし。
- mutationはmark-v3限定。
- reload-authoritative判定を維持。
- worker/reviewer履歴役割が証明できない場合はUNRESOLVEDのまま。

## テスト

既存18テスト + R2 isolationテスト = 19テスト PASS。
`service_worker.js / sidepanel.js / content.js / offscreen.js` の `node --check` PASS。
