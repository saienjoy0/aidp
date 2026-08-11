# AIDP ↔ ChatGPT Bridge v0.7.9 Beta 10 修正報告

## 修正対象

Beta 9コード監査で確認された、永続化確認の重大3点と版混在を修正した。

## 実装変更

1. **手動再読み込みの実行証明**
   - content scriptのdocument instanceごとにランダムな `page_instance_id` を生成する。
   - 適用時IDをtransaction journalへ保存する。
   - 保持確認では、確認時IDが適用時IDと異なることを必須条件にする。
   - 同一IDならfingerprint判定を開始せず、journalを確認待ちのまま維持する。

2. **不安定snapshotの誤使用防止**
   - 安定確認タイムアウト時に最後のsnapshotを返す処理を削除した。
   - Model／Wave／Table三重照合が成立し、同一fingerprintが2回連続した場合だけ結果を返す。

3. **`not_applied` の行き止まり解消**
   - 再読み込み後に適用前backupへ戻っていた場合、`not_applied` を終了状態として保存する。
   - 復元操作は不要で、次のdry-run・適用を開始できる。

4. **新旧content adapter混在防止**
   - service workerとcontent scriptの版を完全一致で検査する。
   - 不一致時は処理を停止し、AIDPページの手動再読み込みを要求する。

5. **版番号統一**
   - manifest、service worker、content、offscreen、Side Panel、README、TEST_REPORTをv0.7.9 Beta 10へ統一した。

## 安全境界

- 自動再読み込みは行わない。
- 暂存・提出は操作しない。
- 話者、人声类型、保留／丢弃、split／add／deleteは無効のまま。
- start／end／textだけがdry-run後の適用対象。

## 検査

- 全JavaScript構文: PASS
- manifest／ruleset／sample patch JSON構文: PASS
- 監査指摘C1～C3を対象にした静的自動検査: PASS
- ZIP整合性: PASS

AIDPサーバー側への永続化はローカル静的検査だけでは証明できないため、最初は検証案件で実機確認する。
