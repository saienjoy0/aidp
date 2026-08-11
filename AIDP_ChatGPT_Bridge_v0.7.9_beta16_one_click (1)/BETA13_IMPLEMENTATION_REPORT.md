# AIDP ↔ ChatGPT Bridge v0.7.9 Beta 13 実装報告

## 目的

Beta 12で実機確認済みの字幕・時刻・一時保存経路を維持したまま、字幕の分割、小条追加、小条削除を安全に実行できる構造操作層を追加する。

## 有効化したoperation

- `split_region`
- `add_region`
- `delete_region`

3種類とも、dry-run後にSide Panelで対象operationをすべて個別チェックし、最新snapshotで再dry-runしなければ適用できない。

## 実装経路

- 追加: Neeko `handleAddRegion(region)`
- 削除: Neeko `handleRemoveRegion(region)`
- 分割: 2つ目のpartを`handleAddRegion`で追加後、元regionをReact字幕経路＋Neeko時刻経路で先頭partへ変更
- 新規ID: dry-run時に現在ID集合と衝突しない`region_<timestamp>_<suffix>`形式を予約
- `round_id`: 構造変更後の時刻順で1から連番になる状態をdry-run予定値とする

## 保存・反映確認

各構造operation後に以下を確認する。

1. `/api/dispatch/SubmitTempItemAnswer`
2. HTTP 200
3. `data.regions`と`dataMap.regions`の全件一致
4. dry-run予定の件数・ID・字幕・時刻・話者・保留・人声类型・品質・`round_id`
5. Model / Wave / Table三重照合
6. 全件状態が2回連続して安定

## rollback

- add: 作成regionを削除
- delete: 同一IDと元の全フィールドで再追加
- split: 追加partを削除し、先頭partを元regionへ復元

現在状態が適用前backupまたは各operation完了後の既知状態と一致しない場合、ユーザーの手動編集を上書きしないため自動rollbackを停止する。

## 引き続き無効

- 既存regionの話者番号単独変更
- 既存regionの人声类型単独変更
- 既存regionの保留／丢弃単独変更
- 提出
- 暂存ボタン操作

## 検証状態

- JavaScript構文検査: PASS
- update_region既存テスト: PASS
- split/add/delete dry-run・個別承認・連続round_idシミュレーション: PASS
- Beta 13静的安全検査: PASS
- 実AIDPでの構造操作・保存・再読み込み保持・rollback: 未実施

最初の実機検証は未提出の案件で行い、保持確認まで提出しない。
