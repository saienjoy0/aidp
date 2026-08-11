# AIDP ↔ ChatGPT Bridge v0.7.9 Beta 12 実装報告

## 目的

Console実機検証で確定した正式な更新・保存経路をBeta 11本体へ統合し、ユーザー操作を増やさずに内部安全確認を強化する。

## 変更点

### 字幕

旧方式:

- DOM `input` / `change`イベント
- Neeko `handleUpdateRegion`への字幕同時投入

Beta 12:

1. content adapterが対象regionのページへ移動してexpected字幕を照合
2. MAIN worldでtextarea直下の `__reactProps$...onChange`を取得
3. ネイティブvalue setterで値を設定
4. React `onChange`を実行
5. textarea、`newResult.data.regions`、`newResult.dataMap.regions`が2回連続一致するまで確認
6. 元の表ページへ戻る

### 時刻

- `handleUpdateRegion(regionId, completeRegion)`へ `start / end`のみを渡す
- 字幕本文は渡さない

### 一時保存確認

各operation開始前にMAIN worldのXMLHttpRequestを短時間だけ読み取り専用traceする。

確認対象:

- endpoint: `/api/dispatch/SubmitTempItemAnswer`
- HTTP status: 200
- `data.regions` / `dataMap.regions`の件数一致
- ID配列一致
- 対象regionのtext/start/end一致
- 2.5秒の通信静穏期間

traceはoperation終了時に必ず解除する。レポートには要約だけを残し、Payload全体は保存しない。

### 失敗処理

- React字幕またはNeeko時刻の局所失敗: 変更済み部分を補償
- 一時保存未確認: 成功扱いにせず、journalの安全分類と逆順rollbackへ移行
- 対象外region変化、全件fingerprint不一致: 従来どおり停止・rollback

## 安全境界

- 暂存ボタンを押さない
- 提出ボタンを押さない
- 自動再読み込みしない
- CDP、debugger、PointerEvent、px/秒変換を使わない
- 構造操作とユーザー判断ラベルはOFF
