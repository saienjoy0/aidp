# AIDP ↔ ChatGPT Bridge v0.7.9 Integrated Beta 17

Beta 17は、Beta 13〜16の構造テストで残った `recovery_required` / 孤立region問題を修復する安全復元版です。`start / end / text` の通常適用は維持し、構造operationが途中失敗した場合は「完全成功checkpoint」だけでなくjournal由来の部分状態を分類して逆適用します。一方、現在確認済みのNeeko `handleAddRegion` は完成済みregion IDを受け取るAPIであり、AIDP自身の新規ID生成経路はまだ実機確定していないため、通常の `split_region / add_region / delete_region` はfeature flagで停止しています。既存journalの補償復元は引き続き利用できます。

AIDPの現在案件をChatGPT用ZIPへ書き出し、ChatGPTが返した修正JSONをdry-runで検査し、dry-run差分確認後に `start / end / text` をAIDPへ反映するChrome / Edge Manifest V3拡張です。構造操作は既存journalの復元に限って使用し、通常patchからのsplit/add/deleteは現在停止しています。

## Beta 12で確定した実機経路とBeta 13の構造経路

- 字幕：行内textareaのネイティブvalue setter＋直下React `onChange`
- 時刻：Neeko `handleUpdateRegion(regionId, completeRegion)`
- 保存対象：`newResult.data.regions` と `newResult.dataMap.regions`
- `newResult.item.regions` は元データ基準として古い件数・値を保持し得るため、編集結果判定には使わない
- 各operation後に `/api/dispatch/SubmitTempItemAnswer` を観測し、対象region、件数、ID配列、HTTP 200を確認
- 保存確認後にModel / Wave / Tableの全件照合を行う
- 暂存ボタン・提出ボタンは操作しない

実機では字幕単体、時刻単体、2regionの字幕＋時刻同時変更、dry-run拒否、自動rollback、手動再読み込み後の全件一致がすべてPASSしました。

### Beta 13の構造操作

- `split_region`: 元regionのIDを先頭partに残し、2つ目のpartにはdry-run時に衝突しないIDを予約
- `add_region`: `start / end / text / speaker / keep / voice_type`を必須とし、初期安全版では`keep=保留`のみ
- `delete_region`: 現在値の`expected`完全一致を必須化し、適用ボタンを最終確認とする
- 分割・追加・削除を含む通常patchはfeature flagで拒否（AIDP固有ID生成の実機確認後に再有効化）
- 構造変更後は全regionを時刻順に照合し、件数、ID、連続`round_id`、字幕、時刻、ラベル、三重照合を確認
- rollbackは逆操作で実施し、追加は削除、削除は同一IDで再追加、分割は追加part削除＋元region復元
- 現在状態がbackupまたは既知のoperation完了状態と一致しない場合は、ユーザー編集を保護するため自動復元を停止

Beta 17では、既存journalの構造復元時にhandleAddRegion / handleRemoveRegionを補償操作として利用し、一時保存PayloadとModel/Wave/Tableの安定状態を確認します。部分状態を安全に分類できない場合や最終backup fingerprintへ戻らない場合は成功扱いせず `recovery_required` のまま停止します。

## Beta 10の保持確認

保持確認ボタンはAIDPを自動再読み込みしません。適用時と確認時の `page_instance_id` を比較し、**手動再読み込みが実際に行われたことを確認できない限り、永続化判定へ進みません**。

1. 適用完了後、AIDPページを `Ctrl + R` で手動再読み込みする
2. 「手動再読み込み後：45秒待って保持確認」を押す
3. 押下後45秒間、拡張機能はAIDPのDOM・React・波形・表を検査しない
4. 45秒後、適用時と異なるページ固有IDであることを確認する
5. Table／Model／Waveの準備完了と、全件fingerprintの2回連続安定を確認する
6. 適用結果、適用前backup、どちらでもない状態の3種類を判定する

手動再読み込みが確認できない場合はjournalを確認待ちのまま残すため、再読み込み後に同じボタンを再実行できます。変更が保持されず適用前backupへ戻った場合は `not_applied` の終了状態となり、次のdry-run・適用へ進めます。

## 動作方針

- PC内完結
- 外部サーバーなし
- AIDPへの自動ログインなし
- 暂存・提出ボタンを操作しない
- `debugger`権限、CDP、合成PointerEvent、px/秒ドラッグを使わない
- 話者、人声类型、保留／丢弃、映像依存判断は初期自動適用しない

## 実装済み

### 案件ZIP書き出し

- 全ページを「前へ／次へ」で巡回
- 行内 `textarea.neeko-input-textarea` のみを字幕として取得
- Model / Wave / Tableの三重照合
- 16kHz mono PCM16 WAV
- PCMから生成する波形PNG
- 最新ruleset、媒体範囲、前後fingerprint、capability診断
- 生メディアURL、query、pathをZIPへ含めない
- 長時間処理はPort jobで実行

### 修正JSON

- `aidp-chatgpt-patch/v3`
- case_key / snapshot / fingerprint / region ID / expectedを検査
- 変更前後の差分表示
- 変更後状態を仮想計算して重複、逆転、10秒超、範囲外を検査
- `start / end / text`に加え、dry-run済みの`split_region / add_region / delete_region`を適用可能

### 適用・復元

- 適用前snapshotを `chrome.storage.local` に保存
- operation journal
- React Fiberから毎回Neeko componentRefを再検出
- 字幕は `textarea.neeko-input-textarea` のReact `onChange`を直接使用
- 開始・終了時刻は `handleUpdateRegion(regionId, completeRegion)` を使用
- 1operationごとに一時保存Payloadの `data.regions` / `dataMap.regions` とHTTP 200を確認
- 1operationごとにModel / Wave / Tableを全件再取得
- 更新操作では対象外regionが変化したら停止し、構造操作ではdry-run予定の全件状態と一致しなければ停止
- 失敗時は適用済みoperationを逆順に補償復元
- 適用後、ユーザー操作でページ再読込し永続化確認
- apply / persistence / recovery reportをJSON保存可能

## feature flag

有効：

- update_region
- split_region（dry-run差分確認後に1クリック適用）
- add_region（dry-run差分確認後に1クリック適用）
- delete_region（dry-run差分確認後に1クリック適用）

引き続き無効：

- 既存regionのspeaker変更
- 既存regionのvoice_type変更
- 既存regionのkeep変更
- 任意の並び順だけを変更する操作

## インストール

1. ZIPを展開
2. Chrome: `chrome://extensions/` / Edge: `edge://extensions/`
3. 開発者モードをON
4. 「展開して読み込み」
5. 展開したフォルダを選択
6. AIDPの `mark-v3` 案件を再読込
7. 拡張アイコンからSide Panelを開く

## 基本フロー

1. 「現在案件をZIPにする」
2. ZIPをChatGPTへ添付
3. ChatGPTが返した修正JSONを「修正取込」へ読み込む
4. dry-runの差分・理由・警告を確認
5. 「適用」タブで検査済み修正を1回押して適用
6. AIDPページを手動で再読み込み
7. 「手動再読み込み後：45秒待って保持確認」
8. AIDP上で最終確認し、ユーザーが提出

## 修正JSON

`sample_patch.json`を参照してください。`expected`は必須です。ZIPを書き出した後にAIDPが変更されていれば、snapshot / fingerprint / expectedのいずれかで拒否します。

## AIDP構造の前提

- 表: `tbody > tr.arco-table-tr`
- region ID: `region-region_xxx` class
- 字幕: 行内 `textarea.neeko-input-textarea`
- 波形: `region.waver-region[data-id]`
- React / Neeko: `getWavesurferInstance`, `handleUpdateRegion`, `handleAddRegion`, `handleRemoveRegion`, `handleChooseRegion`

内部APIは公開仕様ではありません。検出できない、メソッドがない、三重照合が不一致の場合は書き込みを拒否します。

## 標検ルールの扱い

内蔵 `diagnostics/ruleset.json` は2026-07-23更新版に基づきます。機械検査できるものと、音声・映像・ユーザー判断が必要なものを分離します。

- 前後留白0.5秒、内部無音1秒は音声解析結果がある場合の候補
- 普通小条10秒上限、歌词は成文ルール上免除
- 同一話者重複と異なる話者の同時発話を区別
- 日語ITN・標点・表記はcase全体の統一性を重視
- 話者変更、同時発話、異口同声、映像同期、センシティブ、大条保留／丢弃はユーザー判断

## 既知の制約

- `start / end / text` の変更・一時保存・rollback・手動再読み込み後保持は、実機統合試験で確認済みです。
- AIDPの内部構造変更時はadapter検出が停止する可能性があります。
- 完全なDBトランザクションではなく、operation単位の補償ロールバックです。
- Side Panelを閉じてもjournalは残りますが、実行中Portの切断はエラー扱いです。

## 提出について

本拡張には提出処理を実装していません。提出は必ずユーザーがAIDP画面で最終確認後に行います。


## 現時点の実機未確認事項

- 通常の `start / end / text` は実機検証済みです。今後の本番確認は異なる実案件で3回連続して実施します。
- 変更前後の音声区間プレビューUIはまだ未実装です。
- split／add／deleteはdry-run差分確認後、適用ボタン1回で実行します。話者・人声类型・保留／丢弃の既存regionへの単独変更は無効です。
- `speaker_desc`の独立フィールドは現行画面構造から確定できないため、案件ZIPでは `null` として明示します。

適用は一括契約です。`review_required` または `rejected` が1件でも含まれるpatchは、部分適用せず全体を停止します。


## Beta 2 修正

現在案件に変更前から存在する範囲外regionや不正区間がある場合でも、無関係な安全な修正JSONのdry-runを実行できるようにしました。既存問題は警告として残し、修正によって新規発生・悪化した構造問題のみを適用拒否します。

## v0.7.4 Beta 5 の診断改善

適用処理が成功前に停止した場合でも「適用レポート」を保存できます。レポートには、失敗段階、エラー、journalの有無、適用済みoperation、自動補償復元結果が含まれます。失敗時もAIDPの提出は操作しません。


## v0.7.4 Beta 5：適用操作の簡略化

通常の `start / end / text` 更新は、dry-runで案件・fingerprint・expected値・差分を検査済みのため、適用時のチェックボックスと「適用」の文字入力を廃止しました。

操作は次の3段階です。

1. 修正JSONを読み込む
2. dry-runする
3. 「N件をAIDPへ適用」を1回押す

Beta 17では通常split/add/deleteをfeature flagで停止しています。話者、保留／丢弃、人声类型の既存region単独変更も引き続き無効です。構造操作はjournal recovery内の補償だけに限定し、提出は自動化しません。


## v0.7.4 Beta 5：書き込み経路の分離

- 字幕本文は、小条行内の `textarea.neeko-input-textarea` に対してネイティブvalue setterを使ったうえで、DOMイベントではなくtextarea直下の正式なReact `onChange`を呼びます。
- 開始・終了時刻は `handleUpdateRegion` を使用します。字幕本文を `handleUpdateRegion` へ渡しません。
- 字幕と時刻を同時変更するときは、実機で成功した順序どおり字幕React更新→時刻Neeko更新を行います。局所失敗時は変更済み部分を補償し、全体失敗時はjournalから逆順rollbackします。
- 座標ドラッグ、px換算、CDP、提出操作は使用しません。

## v0.7.5 Beta 6：字幕の二重同期

Beta 5～11では字幕経路を試行しましたが、実機検証により正しい経路はtextarea直下のReact `onChange`であり、これだけで `data.regions` と `dataMap.regions` の字幕が更新されることを確認しました。Beta 12以降は字幕を `handleUpdateRegion`へ渡す二重同期を廃止し、React経路へ一本化しています。


## 履歴：v0.7.7 Beta 8の再読み込み後準備完了待機

従来の保持確認は、ボタンを押すとAIDPを自動再読み込みした直後、content adapterへ接続できた時点で全件検査を始めていました。通信が遅い環境では、表や波形がまだ展開中でも接続だけ先に成功し、検査が早すぎる問題がありました。

Beta 8では「再読み込み→30秒待機→保持確認」を1回押すと、次を自動実行していました。Beta 10では自動再読み込みを廃止し、ページ固有IDによる手動再読み込み確認へ置き換えています。

1. AIDPを再読み込み
2. ブラウザのタブ状態が `complete` になるまで待機
3. 完了後さらに30秒待機
4. Table／Model／Waveの全件数が一致する状態を3回連続で確認
5. 全件snapshotのfingerprintが2回連続で安定してから永続化判定

この節は旧版の履歴です。現在のBeta 10は、手動再読み込み後に45秒無検査で待機し、その後に準備完了と安定fingerprintを確認します。


### 既存エラーを改善する修正

変更前から10秒超の小条に対し、範囲外時刻の補正などで長さを短くする修正は、変更後も10秒超が残る場合でも拒否しません。新規発生または悪化だけを拒否し、既存違反が残ることは警告として表示します。
