# Unified Agent Context

[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | **日本語** | [Español](README.es.md)

新しい AI チャットは、いつも記憶喪失から始まる。昨日 Claude に README は英語が
基本と伝えたのに、今朝は Codex が同じことを聞いてくる。今夜は三つ目の
アシスタントがまた聞くだろう。エージェントは五つ、彼らが共有する唯一の記憶は
あなただ。あなたは再説明のたびに、少しずつすり減っていく。

**Unified Agent Context はそれを終わらせる。** どのエージェントにでも一度だけ
伝えればいい。他のすべてのエージェントが、次のセッションでそれを知っている。
自動で、どのマシンでも、秘密情報はブロックされたまま。

あなたが手で記憶をつなぐことはない。あるエージェントのコンテキストを別の
エージェントに写すこともない。それが約束のすべてだ。もし自分でやる羽目に
なったら、UAC の負けだ。

![UAC 27秒デモ](artifacts/promo/uac-promo.gif)

## 仕組み

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: store-host ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 store-host Letta "The Noticer" inbox (Phase 5)
```

かみくだいて言うとこうなる。

- すべてのエージェントがひとつの共有メモリを読み書きする。
- 好みはどこへでもついてくる。プロジェクトの決定はそのプロジェクトの中だけに残る。
- 決定と好みは永久に保存される。作業状態は 90 日で消える。
- 生の会話はセッションに注入されない。秘密情報を消したうえでコールドアーカイブにだけ残る。
- すべての書き込みはシークレットゲートを通る。キーやパスワードは最初から弾かれる。
- ストアにつながらないときは、エージェントが黙って進まず大きな声で知らせる。
- 正本ストアは store-host という自宅サーバー一台にある。他のマシンは ssh で届く。

## ドキュメント

| ドキュメント | 何の話か |
|------|------|
| `docs/phase0-comparison.md` | どのストアを選んだか、なぜか。 |
| `docs/phase1-storage.md` | スキーマ、スコープ、保存期間、シークレットゲート。 |
| `docs/phase2-hooks.md` | 五つのエージェントをどうつないだか。 |
| `docs/phase3-write-paths.md` | 事実が書かれる五つの道、蒸留と検疫。 |
| `docs/phase4-coverage-matrix.md` | 二十の伝達経路、すべてテストで検証。 |
| `docs/phase5-librarian.md` | 永久ファクトをキュレーションするライブラリアンレーン。 |
| `docs/phase6-remote.md` | 正本ストアの store-host 移行と ssh アクセス。 |
| `docs/onboarding.md` | 新しいエージェントが五分で参加する方法。 |
| `docs/handoff-tailscale-connectivity.md` | ストア接続が不安定なときの対処。 |

## コマンド

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # 共有コンテキストブロックを出力
node scripts/record-fact.mjs --type decision "..."   # 明示的記録（秘密情報は exit 3 で遮断）
node scripts/distill-session.mjs --file <transcript> # セッション蒸留 + 検疫スイープ
node scripts/librarian-sync.mjs [--strict]           # outbox → store-host ライブラリアン inbox 配送 (Phase 5)
node scripts/doctor.mjs                              # 配線セルフチェック
node scripts/cross-verify.mjs                        # 20 経路カバレッジマトリクス再実行
node scripts/reexplain.mjs log|report                # 再説明の計測（2 週間ゲート補助指標）
node --test 'tests/*.test.mjs'                       # 全テスト (73)
```

## 二週間テスト

シナリオテストはすべて通った。本当のテストは別にある。二週間ふだん使いして、
同じことを二度説明する瞬間がまだあるかどうかだ。繰り返しが起きるたびに
`reexplain.mjs log` で記録する。週ごとの回数がゼロに落ちれば UAC の勝ちだ。

## クレジット

**[GJC, Gajae Code](https://github.com/Yeachan-Heo/gajae-code)**、AI コーディング
エージェントとともに最初から最後まで作った。ストアの各フェーズ、5 言語 README の
物語スタイル、上のプロモアニメーションまで、GJC が実装し、検証し、出荷した。
作っている間、UAC 自身の共有メモリを使っていた。
