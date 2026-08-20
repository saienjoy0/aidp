# Beta 16 Implementation Report

## Goal
構造操作の二重確認を廃止し、dry-runで差分を確認した後に適用ボタンを1回押すだけの操作へ簡略化する。

## Removed
- split/add/deleteごとのチェックボックス
- 「選択したsplit/add/deleteを承認して再検査」ボタン
- 同じ差分を二度確認するreview_required UIフロー

## Preserved safety
- source_snapshot_id / source_fingerprint一致
- expected完全一致
- 件数、ID、round_id、重複、時間範囲のdry-run検査
- SubmitTempItemAnswerのdata/dataMap全件・HTTP 200確認
- Model / Wave / Table照合
- journal / rollback / stale applying安全解除
- 暫存・提出の非自動化

## User flow
修正JSON読込 → dry-run差分確認 → 適用ボタン1回 → 手動再読み込み後の保持確認
