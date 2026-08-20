# 実装根拠

この統合ベータは、次の情報を組み合わせて設計・実装した。

1. `单语种译制片字幕对齐-标检规则_2026-07-23更新版` と `リンクアクセス方法.txt` の修正確認
   - 前後留白0.5秒
   - 内部無音1秒
   - 普通小条10秒上限、歌词の扱い
   - 完整意群、分句禁止箇所
   - 日本語ITN・標点・case内統一
   - 話者番号、丢弃小条、同時発話、文本遗漏の扱い
2. `AIDP_ChatGPT_Bridge_Integrated_Beta_Design_v0.7`
   - 書き出し、dry-run、適用、journal、復元、提出なし
3. `AIDP_ChatGPT_Bridge_redesign_v0.6_spec`
   - Model / Wave / Table三重照合
   - MAIN world Neeko Adapter
   - 座標ドラッグ方式の廃止
4. `aidp_*_platform_internals_diagnostic.json`
   - React / MobX / neeko-wavesurfer
   - `handleUpdateRegion`, `handleAddRegion`, `handleRemoveRegion`, `handleChooseRegion`
   - `getWavesurferInstance`
5. 旧版v0.3〜v0.6の実装・実機結果
   - 表外textareaを除外
   - 全ページ巡回
   - ページ省略表示への対応
   - WAV、波形PNG、ZIP生成
   - Port job方式
6. region_42事故・復元レポート
   - px/秒、合成PointerEvent、CDP、Ctrl付きドラッグを通常編集方式にしない
   - 対象案件固定コードを作らない
   - 部分成功を許さない
7. AIDP 2026-07-22追加ショートカット表示
   - Ctrl/AltはUI互換情報として保持し、通常適用はID指定Neeko APIを優先
8. `日语时薪解释.txt` とこのチャットで確定した役割分担
   - ChatGPT: 音声・字幕・start/end・表記・分割候補
   - ユーザー: 話者、人声类型、同時発話、映像依存判断、大条判断、最終確認、提出

初期書き込み対象は `start / end / text` のみ。話者・ラベル・構造変更はコード上のfeature flagで無効化している。

9. `BETA9_CODE_AUDIT.md`
   - 適用時・確認時のページ固有ID比較
   - 不安定snapshotの判定利用禁止
   - `not_applied` の終了状態化
   - content adapter版不一致時の強制停止
   - UI・manifest・文書の版番号統一
