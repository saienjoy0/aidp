# AIDP Bridge — 非回帰契約 / 忘れてはいけない仕様

更新: 2026-08-19
対象: Beta 42 QC One-Click R2 系

この文書は、後続のChatGPT/Codex実装で「前に直したことを忘れて元に戻す」事故を防ぐための固定契約です。機能追加時は、まずこの契約を満たすことを確認します。

## 1. タブと案件の分離

1. Side Panelの表示対象は **現在アクティブなAIDPタブ** に追従する。
2. 一度見たタブへ永久pinしてはいけない。
3. JSON入力、dry-run結果、状態表示、Journal表示、レポートは **tabId + 案件識別子** 単位で分離する。
4. mark-v3はURLだけを案件IDとして扱わない。可能なら `题目ID`、次に `Call ID` を使う。
5. 同じtabId・同じURLでも题目ID/Call IDが変われば別案件として扱う。
6. SPAでURLが変わらない案件切替も検知する。

## 2. 実行中ジョブの固定

1. UI表示はアクティブタブへ追従してよい。
2. ただし開始済みジョブは開始時の `tabId + case_instance_key` に固定する。
3. ジョブ途中で同じタブが別案件へ切り替わった場合は STOP。別案件へ処理を継続しない。
4. 自動再試行で別案件へ書き込み/取得してはいけない。

## 3. 同時実行

1. ZIP書き出しはタブ単位で独立管理する。AタブのZIP中でもBタブのZIPを開始できる。
2. 同じタブでZIPを二重起動しない。
3. mutation（適用・復元）は全ブラウザで1件だけの global lock を維持する。
4. mutation中はZIP開始禁止。ZIPが1件でも動作中ならmutation開始禁止。
5. dry-runは同じタブのZIP中だけ止め、別タブの読み取り処理とは不必要に干渉しない。

## 4. ワンクリックZIP

①「案件ZIPを書き出す」が通常作業・検査・返修の共通入口。

### mark-v3
- case / regions / audio / waveform / rules / diagnostics を取得。
- export前後snapshotを比較。
- fingerprint・件数・案件識別が変化したらZIP保存せずSTOP。

### QC / 返修
- 現在小条
- `无问题 / 有错误`
- QCエラー理由候補
- `质检备注`
- 回答Version
- Version差分
- 関連AIDP dispatch通信
- CURRENT_RULES / REWORK_QC_GUIDE
を同じZIPへ入れる。

## 5. 返修履歴の証拠ルール

- `worker_submitted_value`
- `qc_result`
- `qc_error_reason`
- `qc_comment`
- `reviewer_corrected_value`
- history / trace
を可能な限り取得する。

worker提出と验收修正の役割対応がプラットフォーム上で証明できない場合は `NOT_OBTAINED` / `UNRESOLVED` とする。
**現在値を「元の提出値」と推測してはいけない。**

## 6. 現行字幕ルールの最低非回帰点

- 背景歌詞: `人声类型=歌词`, `说话人序号=BGM`。
- `BGM` はspeaker parserで必ず保持する。
- BGMは数値speaker連番に算入しない。
- `unk` は推測不能の場合に限定。
- 原声+目标语种配音の双声混が画面時長5%超なら大条丢弃。
- 通常の说话小条は10秒超かつ合理的に<=5秒へ分割可能ならQCエラー。
- 現行ルール入口は CURRENT_RULES.md を優先する。

## 7. 書き込み安全契約

- `暫存` を自動クリックしない。
- `提交` を自動クリックしない。
- 成功判定を即時DOM/Waveだけで行わない。
- reload後のserver由来状態を最終権威とする。
- source snapshot / fingerprint / expected値が古ければ書き込まずSTOP。
- Port切断を成功扱いしない。
- 不明状態で追加書き込みを行わない。

## 8. レポート

- レポートはtabIdだけでなく案件でも分離する。
- 新案件で前案件のdry-run/apply/restore/export reportを表示・DLしてはいけない。

## 9. リリース前チェック

最低限以下を毎回確認する。

- active tabがA→B→Aで正しく切り替わる
- A/BのJSON・dry-run・Journalが混ざらない
- 同じタブの案件変更で状態がリセット/復元される
- A/BのZIPジョブが独立する
- mutation global lockが維持される
- job中案件切替でSTOPする
- BGM speakerが取得できる
- QC ZIPにqc/history/diffが入る
- `暫存` / `提交` 自動操作がない
- 全Nodeテストと `node --check` がPASS

## 10. GitHub運用

GitHubを継続的な記憶として使う。

- `current/` は現在の別系統（Contract Lab等）を勝手に上書きしない。
- 安定版・実験版は `releases/` または専用branchへ保存する。
- 本文書を変更する場合は、変更理由とテストを同じcommitに含める。
- 後続作業では README より先にこの非回帰契約を確認する。
