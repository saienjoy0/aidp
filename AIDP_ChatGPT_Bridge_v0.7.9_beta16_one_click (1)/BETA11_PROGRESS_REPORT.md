# AIDP ↔ ChatGPT Bridge v0.7.9 Beta 11 進捗報告

## 目的

Beta 10の `start / end / text` を実機で安定化した後、`split_region` と `add_region` をAIDP自身のID生成・保存経路で段階的に完成させる。

## コード変更

- 全ページ巡回中および完了時の小条総数変化を検出して停止する。
- 話者フィルターが有効な場合は全件取得・書き込みを拒否する。
- 元メディア取得時のcredential自動切替・自動再試行を廃止した。
- `executing` 中に例外となったoperationもrollback候補から除外せず、現在値との照合で安全分類する。
- Neeko method metadata、region schema、WaveSurfer region API、`data` / `dataMap`集計候補を読み取り専用で診断できるようにした。
- `split_region` / `add_region` の厳格なdry-runシミュレーションと個別承認ゲートを実装した。
- 構造操作用の仮IDはdry-run表示専用であり、AIDPへの書き込みIDには使用しない。

## 現在のfeature flag

- `update_region`: ON
- `split_region`: OFF
- `add_region`: OFF
- `delete_region`: OFF
- `set_labels`: OFF
- 暂存・提出: 実装なし

`split_region` / `add_region` は実機でAIDP自身のID生成、round_id、表順、集計、保存、再読み込み保持、rollbackがすべてPASSするまでONにしない。

## 自動検査

- 全JavaScript構文: PASS
- JSON構文: PASS
- dry-run・構造操作・安全境界テスト: 16/16 PASS

## 実機で確認済み

- 対象case: `/management/task-v2/7662960445883420462/mark-v3/1`
- 表示総数: 19小条
- AIDP自身が生成したと見られるID形式を既存小条で確認:
  - `region_1785252107058_v50mi0m`
  - `region_1785252183037_osx960u`
- 既存IDを拡張側で推測・生成しない方針を維持する。

## 未完了の実機ゲート

- Beta 11の拡張再読み込み
- 全ページ巡回・ZIP 3回安定・ZIP内hash検査
- dry-run異常系一式
- start/end/textの1件・複数件適用
- 手動再読み込み後の保持
- 意図的途中失敗とrollback
- split/addの実行・保存・保持・rollback
- 1案件End-to-Endリハーサル

