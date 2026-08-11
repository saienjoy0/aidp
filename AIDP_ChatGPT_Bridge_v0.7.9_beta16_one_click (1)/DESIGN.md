# AIDP ↔ ChatGPT Bridge 統合ベータ設計書 v0.7

作成日: 2026-07-31  
対象: Chrome / Edge Manifest V3 拡張  
動作方針: PC内完結・外部サーバーなし・提出自動化なし

---

## 0. この製品は何か

AIDPの現在案件から、ChatGPTが音声と字幕を照合するための材料を1つのZIPにまとめて書き出し、ChatGPTが返した修正JSONを検査・差分表示したうえで、ユーザー承認後にAIDPへ自動反映するローカル拡張機能。

最終的にユーザーが行う操作は、原則として次の4つだけにする。

1. 「案件ZIPを書き出す」
2. ZIPをChatGPTへ添付する
3. ChatGPTが返した修正JSONを読み込む
4. 差分を確認して「適用」を押し、最後にAIDP上で確認・提出する

提出ボタンは拡張機能から操作しない。

---

## 1. 現在作ろうとしている機能

### 1.1 案件ZIP書き出し

AIDPの現在案件から以下を自動取得する。

- 案件識別情報
- 元動画の取得元情報
- 音声だけを抽出したWAV
- 全小条の `region_id / start / end`
- 字幕
- 話者番号
- 保留／丢弃
- 人声类型
- 小条順序
- 有効小条数
- 有効時間
- AIDP表示上のduration
- 実際にデコードした音声duration
- 波形画像
- AIDP内部構造・対応機能の診断結果
- 最新標検ルールの機械判定用設定

出力形式:

```text
AIDP_case_<case-hash>_<timestamp>.zip
├─ manifest.json
├─ case.json
├─ regions.json
├─ audio.wav
├─ waveform.png
└─ diagnostics/
   ├─ capabilities.json
   ├─ validation.json
   ├─ media.json
   ├─ export_guard.json
   └─ ruleset.json
```

### 1.2 ChatGPT修正JSONの取り込み

ChatGPTが返した修正JSONを読み込み、AIDPを変更する前に次を行う。

- JSON schema検査
- 案件ID照合
- snapshot照合
- fingerprint照合
- 小条数照合
- region ID存在確認
- `expected`現在値との照合
- 変更前後の差分表示
- 重複・逆転・10秒超・範囲外検査
- 変更対象外の項目が変わらないか確認
- 各操作を「適用可能／要確認／拒否」に分類
- 変更前後の音声区間プレビュー

### 1.3 AIDPへの自動反映

ユーザーが「適用」を押した後、AIDPの既存コンポーネント操作経路を使って反映する。

初期有効化対象:

- `start`変更
- `end`変更
- `text`変更

明示承認が必要な対象:

- `speaker`変更
- `voice_type`変更
- `keep`変更

内部仕様確認後に有効化する対象:

- 小条分割
- 小条追加
- 小条削除
- 並び順変更

反映後は必ず、Model／Wave／Tableの3経路から全件を再取得して一致確認する。

### 1.4 復元

- 適用前の完全snapshotを保存
- 各操作をjournalへ記録
- 途中失敗時は適用済み操作を逆順に戻す
- ブラウザ再読み込み後も未完了journalを検出
- 未完了journalがある場合、新しい適用は禁止
- 「検査」「復元」「レポート出力」だけ許可

---

## 2. ユーザーとChatGPTの役割分担

### ChatGPTが担当するもの

- 音声と字幕の照合
- 誤字脱字
- 字幕漏れ候補
- ITN
- 句読点
- 表記統一
- start／end調整候補
- 0.5秒超の前後余白候補
- 1秒以上の内部無音候補
- 10秒超小条の分割候補
- 小条追加・分割の修正案
- 修正理由の記録

### ユーザーが判断するもの

- 話者番号
- 話者変更
- 同時発話
- 異口同声
- 人声类型
- 話者説明
- 映像と音声の同期判断
- センシティブ映像
- 大条の保留／丢弃
- 最終確認
- 提出

拡張機能はユーザーが確定した話者・ラベル変更を適用できるが、ChatGPTが自動推測しただけの話者変更は自動適用しない。

---

## 3. 現在までに確認できたAIDPの構造

### 3.1 表

- 表行: `tbody > tr.arco-table-tr`
- region ID: 行内の `region-region_xxx` 系class
- 字幕欄: 行内の `textarea.neeko-input-textarea`
- 表外にも別textareaがあるため、全textarea取得は禁止
- ページネーションがある
- 1ページだけ取得しても全件にならない
- ページ番号省略表示を前提に、前へ／次へで全巡回する

### 3.2 波形

- 小条: `region.waver-region[data-id]`
- 開始ハンドル: `.waver-handle-start`
- 終了ハンドル: `.waver-handle-end`
- DOM上のleft／widthは表示値であり、正式な保存値ではない
- 重複小条にはCtrl、既存小条内の切り出しにはAltというAIDP標準操作がある

### 3.3 React / Neeko内部

React Fiberから `neeko-wavesurfer` と内部regionを取得できる。

確認済みメソッド:

- `getWavesurferInstance()`
- `handleUpdateRegion(regionId, region)`
- `handleAddRegion(region)`
- `handleRemoveRegion(region)`
- `handleChooseRegion(region)`

`handleUpdateRegion`は、AIDP内部モデルの時刻とwavesurfer側のregion時刻を同時に更新する。字幕本文の正式経路ではないため、Beta 12では `start / end` のみに使用する。

そのため、時間変更の主方式は座標ドラッグではなく、region IDを指定したNeeko内部操作とする。

### 3.4 保存データ

保存Payloadでは、編集結果のregion情報が以下に存在する。

- `data.regions`
- `dataMap.regions`

`item.regions`は元データ基準を保持し、編集前の件数・字幕・時刻が残る場合がある。編集結果の成功判定には使用しない。

主要フィールド:

- `id`
- `start`
- `end`
- `yuan_text`
- `if_save`
- `is_qualified`
- `music`
- `speaker_desc`
- `round_id`

`valid_duration`は保留小条の合計時間、`valid_region_count`は保留小条数と対応する。

---

## 4. 全体アーキテクチャ

```text
Side Panel UI
    │
    ▼
Job Orchestrator
    ├─ Content Read Adapter
    │    ├─ 表取得
    │    ├─ ページ巡回
    │    ├─ 字幕・ラベル取得
    │    └─ メディアURL検出
    │
    ├─ Main World Neeko Adapter
    │    ├─ React Fiber探索
    │    ├─ Model取得
    │    ├─ Wave取得
    │    ├─ region更新
    │    └─ add/remove/update capability判定
    │
    ├─ Media Worker
    │    ├─ 元動画取得
    │    ├─ 音声デコード
    │    ├─ 16kHz mono PCM16 WAV生成
    │    ├─ 波形PNG生成
    │    └─ ZIP生成
    │
    ├─ Validation Engine
    │    ├─ schema
    │    ├─ snapshot/fingerprint
    │    ├─ Model/Wave/Table三重照合
    │    ├─ 標検ルール
    │    └─ 操作前後差分
    │
    ├─ Transaction Journal
    │    ├─ backup
    │    ├─ operation progress
    │    ├─ checkpoint
    │    └─ rollback
    │
    └─ Report Generator
         ├─ export report
         ├─ dry-run report
         ├─ apply report
         └─ recovery report
```

### 4.1 長時間処理の通信方式

ZIP生成や音声変換は長時間になるため、1回の `sendMessage` 応答で完了を待たない。

- `job_id`を発行
- Port接続で進捗を送る
- 状態を `chrome.storage.session` または `chrome.storage.local`へ保存
- Side Panelを閉じても処理状態を確認可能にする
- 接続断を自動成功扱いにしない
- 同じjobを無断で自動再実行しない

---

## 5. 読み取りの三重照合

AIDPの状態を次の3経路で取得する。

### Model

React props / storeが保持する全region。

### Wave

`getWavesurferInstance().regions.list`に存在する波形region。

### Table

全ページ巡回で取得した字幕・時刻・話者・ラベル。

書き込み許可条件:

```text
Modelのregion ID集合
= Waveのregion ID集合
= Tableのregion ID集合
```

追加条件:

- region数一致
- target regionのstart/end一致
- region ID重複なし
- round_id重複なし
- ページ巡回中に件数変化なし
- フィルター表示中ではない
- 操作前snapshot取得後に案件が変化していない

ZIP書き出しは不一致でも診断付きで許可できるが、AIDPへの書き込みは拒否する。

---

## 6. 案件ZIP仕様

### 6.1 manifest.json

- schema
- export_version
- generated_at
- case_hash
- snapshot_id
- fingerprint
- 各ファイルのsize
- 各ファイルのSHA-256
- export結果

### 6.2 case.json

- case_key
- task ID
- template ID / type
- title
- language
- AIDP duration
- decoded audio duration
- total_region_count
- valid_region_count
- valid_duration
- content fingerprint
- source media metadata
- adapter capability summary

元動画URLはトークンや署名を含む可能性があるため、既定では以下だけ保存する。

- origin
- path hash
- URL hash
- raw URL included: false

### 6.3 regions.json

```json
{
  "schema": "aidp-regions-snapshot/v3",
  "case_key": "/management/task-v2/.../mark-v3/1",
  "snapshot_id": "sha256:...",
  "fingerprint": "sha256:...",
  "regions": [
    {
      "region_id": "region_20",
      "start": 52.38,
      "end": 54.31,
      "text": "...",
      "speaker": "2",
      "keep": "保留",
      "voice_type": "说话",
      "speaker_desc": "",
      "round_id": 20
    }
  ]
}
```

### 6.4 audio.wav

- 16kHz
- モノラル
- PCM16
- 元動画0秒と同じ時間軸
- 音声durationを記録

### 6.5 waveform.png

音声PCMから生成し、以下を描画する。

- 時間目盛り
- 波形
- region境界
- region ID
- 重複・10秒超・範囲外のマーカー

---

## 7. 修正JSON仕様

```json
{
  "schema": "aidp-chatgpt-patch/v3",
  "case_key": "/management/task-v2/.../mark-v3/1",
  "source_snapshot_id": "sha256:...",
  "source_fingerprint": "sha256:...",
  "operations": [
    {
      "op_id": "op-001",
      "type": "update_region",
      "region_id": "region_20",
      "expected": {
        "start": 52.11,
        "end": 54.02,
        "text": "変更前字幕",
        "speaker": "2",
        "keep": "保留",
        "voice_type": "说话"
      },
      "set": {
        "start": 52.38,
        "end": 54.31,
        "text": "その色、すごく似合うから。"
      },
      "reason": "語頭と語尾の調整",
      "confidence": 0.94,
      "requires_user_review": false
    }
  ]
}
```

対応operation:

- `update_region`
- `set_labels`
- `split_region`
- `add_region`
- `delete_region`

Beta 13では `update_region` に加え、`split_region` / `add_region` / `delete_region` を個別承認付きで有効化する。既存regionのラベル単独変更は無効のまま。

---

## 8. 適用エンジン

### 8.1 update_region

```text
PRECHECK
→ 最新snapshot取得
→ expected照合
→ 変更後regionオブジェクト構築
→ textがある場合はtextarea直下React onChange実行
→ start/endがある場合はhandleUpdateRegion実行
→ SubmitTempItemAnswerのdata/dataMap・HTTP 200確認
→ Model再取得
→ Wave再取得
→ Table再取得
→ 対象region一致確認
→ 対象外region不変確認
→ 保存状態確認
→ CHECKPOINT
```

### 8.2 字幕変更

字幕欄のDOMだけを書き換えず、textarea直下の正式なReact `onChange`経路を使用する。

- textareaのネイティブvalue setterで値を設定
- `__reactProps$...` から直下 `onChange` を取得して実行
- DOMの `input` / `change` 合成イベントは使用しない
- `data.regions` / `dataMap.regions` / Tableの一致を確認
- 一時保存PayloadのHTTP 200を確認
- 手動再読み込み後の全件fingerprintを確認

### 8.3 ラベル変更

話者番号・人声类型・保留／丢弃は、ユーザーの明示承認後にAIDPの既存選択UIまたは内部onChange経路で適用する。

### 8.4 split/add/delete

Beta 13では、次の契約で個別承認付き有効化する。

- `split_region`は2part限定。先頭partは元IDを保持し、2つ目はdry-run時に衝突しないplatform互換IDを予約する
- `add_region`はID指定禁止。Bridgeがdry-run時にIDを予約し、`handleAddRegion`へ完全regionを渡す
- `delete_region`は完全な`expected`一致と個別承認を必須にする
- 構造操作後は全件を時刻順に並べ、`round_id`を1から連番で予測する
- 一時保存Payloadの`data.regions` / `dataMap.regions`全件とHTTP 200を照合する
- Model / Wave / Tableの件数・ID・字幕・時刻・ラベル・`round_id`がdry-run予定状態と一致しない場合は停止する
- rollbackは逆操作で実施する。追加→削除、削除→同一ID再追加、分割→追加part削除＋元region復元
- 現在全件状態がbackupまたは既知のoperation完了状態と一致しない場合は、ユーザー編集保護のため自動rollbackを行わない

最初の実機使用は未提出の検証案件に限定し、手動再読み込み後の保持確認まで提出しない。

---

## 9. 検査ルール

基準は `单语种译制片字幕对齐－标检规则 2026-07-23更新版`。

### ハードエラー

- start < 0
- end <= start
- endが実音声範囲を大きく超える
- region ID重複
- expected不一致
- snapshot不一致
- fingerprint不一致
- Model／Wave／Table ID集合不一致
- 操作対象regionが存在しない
- 通常小条が10秒超のまま確定
- 書き出し中／適用中に案件が変化

### 警告・要確認

- 小条間重複
- 完全包含
- 同一話者重複
- 異なる話者の同時発話候補
- 0.5秒超の前後余白候補
- 1秒以上の内部無音候補
- speaker番号の飛び
- 歌词小条の長さ
- 丢弃小条の長さ
- AIDP durationとdecoded durationの差
- case内の日本語ITN／表記不統一

### ルール上、機械確定しないもの

- 同時発話か誤重複か
- 映像と音声の同期
- 話者本人の特定
- センシティブ映像
- 大条丢弃
- 文本遗漏の最終判断

---

## 10. 画面構成

### 画面1: 書き出し

- 接続状態
- 案件ID
- region件数
- AIDP duration
- decoded duration
- ZIP作成
- 進捗
- 最終レポート

### 画面2: 検査

- 三重照合
- 重複
- 10秒超
- ギャップ
- 範囲外
- 話者番号
- ITN／表記統一
- 要ユーザー確認項目

### 画面3: 修正取り込み

- JSON読み込み
- schema結果
- 案件照合
- snapshot照合
- operations一覧
- 変更前／変更後
- 音声プレビュー
- 適用可能／要確認／拒否

### 画面4: 適用・復元

- 適用対象チェック
- 高リスク項目の個別承認
- 適用開始
- operation別進捗
- 再照合結果
- 復元
- apply/recovery report出力

提出ボタンは設置しない。

---

## 11. feature flag

```json
{
  "export_zip": true,
  "patch_preview": true,
  "update_time": true,
  "update_text": true,
  "update_speaker": false,
  "update_voice_type": false,
  "update_keep": false,
  "split_region": "explicit-approval",
  "add_region": "explicit-approval",
  "delete_region": "explicit-approval",
  "submit": false
}
```

機能は同じ統合版へ実装するが、未確認機能はコードを分けずfeature flagで無効化する。

---

## 12. 失敗時の扱い

### 読み取り・ZIP失敗

- AIDPデータは変更しない
- jobの失敗位置とエラーを表示
- 同じjobの再開または新規再実行を選べる

### 適用前失敗

- AIDPデータは変更しない
- 差分表示へ戻る

### 適用途中失敗

```text
STOP
→ journal確認
→ 適用済みoperationを逆順で戻す
→ Model/Wave/Table再照合
→ recovery_report.json
```

### 保存確認不能

成功扱いにしない。

```text
UI反映済み
永続化未確認
```

として表示し、再読み込み後の検証を要求する。

---

## 13. 廃止する方式

- px/秒を主軸とする時間編集
- 合成PointerEvent
- CDP／debugger権限による通常編集
- Ctrl付き自動ドラッグを主方式にする設計
- DOM style直接変更
- 失敗時の別方式自動再試行
- 対象案件固定コード
- region_42専用コード
- 字幕だけ成功し時間変更が失敗しても続行する部分成功

Ctrl／Altショートカットは、AIDP内部APIが使えない場合の診断・互換情報として保持する。

---

## 14. 今回作る統合ベータの範囲

### 必ず完成させる

- 案件ZIP書き出し
- job方式の安定した長時間処理
- 全ページ巡回
- Model／Wave／Table三重照合
- WAV／波形PNG生成
- 最新ルール検査
- 修正JSON読み込み
- dry-run
- 差分表示
- start／end／text適用
- 適用前backup
- operation journal
- 適用後再照合
- 復元
- 各種report
- 提出なし

### 実装するが初期無効

- speaker変更
- voice_type変更
- keep変更
- split
- add
- delete

### 対象外

- ChatGPTとの直接通信
- 外部サーバー
- AIDPへの自動ログイン
- 自動提出
- ユーザーに代わる映像依存判断

---

## 15. 完成判定

統合ベータは、次をすべて満たしたら「実用試験可能」とする。

1. 同じ案件から3回連続で同一fingerprintのZIPを生成できる
2. ZIP内ファイルhashがmanifestと一致する
3. Model／Wave／Tableの全regionが一致する
4. 音声時間軸がAIDP波形と一致する
5. 修正JSONのexpected不一致を確実に拒否する
6. start／end／textを1件・複数件とも正しく反映できる
7. 対象外regionが変化しない
8. 再読み込み後も変更が保持される
9. 途中失敗時にjournalから復元できる
10. 暂存・提出を一度も自動操作しない

---

## 16. 実装の次の一手

次に作るのは、細分化した0.7／0.8／0.9ではなく、1つの統合ベータ版。

名称:

```text
AIDP ChatGPT Bridge v0.7 Integrated Beta
```

優先順:

1. v0.6.xで発生した長時間メッセージ切断をjob方式へ置換
2. ZIP書き出しを安定化
3. patch preview／dry-runを統合
4. `handleUpdateRegion`によるstart／end適用
5. text変更
6. backup／journal／復元
7. ラベル・split/add/deleteをfeature flag付きで実装

---

## 17. 根拠資料

- `AIDP_ChatGPT_Bridge_redesign_v0.6_spec.md`
- `aidp_7662960445883420462_1785427898419_platform_internals_diagnostic.json`
- `单语种译制片字幕对齐-标检规则_2026-07-23更新版.md`
- 既存のAIDP Bridge v0.3～v0.6実装
- region_42復元試行レポート
- AIDP画面の2026-07-22追加ショートカット説明

