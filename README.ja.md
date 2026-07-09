# Unified Agent Context

[English](README.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md) | **日本語** | [Español](README.es.md)

新しい AI チャットは、いつも記憶喪失から始まる。昨日 Claude に「README は英語が
デフォルト」と伝えたのに、今朝は Codex が同じことを聞いてくる。今夜は三つ目の
アシスタントがまた聞くだろう。あなたは五つの AI エージェントを使っているが、
彼らが共有する唯一の記憶はあなた自身だ — そしてあなたは再説明のたびに、
少しずつすり減っていく。

**Unified Agent Context はそれを終わらせる。** どのエージェントにでも、決定を
一度だけ伝えればいい — claude code、codex、hermes、gajaecode、lettacode — 他の
すべてのエージェントが、次のセッションでそれを知っている。自動で、どのマシンでも、
秘密情報は設計段階からブロックされたまま。

![UAC demo](artifacts/promo/uac-promo.gif)

## アーキテクチャ（正本 = sov、デバイス非依存アクセス）

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: sov ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 sov Letta "The Noticer" inbox (Phase 5)
```

- スコープ: `global`（好み）vs `project:<git-root-basename>`（決定／作業状態）— プロジェクト間のリークを遮断（サーバー側クエリで強制）
- TTL: decision/preference は永続保存、project_state は 90 日
- 生の会話はコールドアーカイブのみ（注入禁止、秘密情報は redact のみ）
- degraded mode: サーバー到達不能時に 4 種のエビデンス（warning/log/health/metric）を発行。`UAC_STRICT=1` ならハード失敗
- デバイス非依存: 正本ストアは sov — Mac などの他マシンは `uac.config.json` の ssh スポーンでアクセス（Phase 6）
- v2 予定: オフラインローカルキュー + 再同期 / セルフホスト・リモート MCP + 認証 → claude.ai 参加

## ドキュメント

| ドキュメント | 内容 |
|------|------|
| `docs/phase0-comparison.md` | ストア候補の比較表 + 採用根拠 |
| `docs/phase1-storage.md` | スキーマ／スコープ／TTL／シークレットゲート |
| `docs/phase2-hooks.md` | 5 ハーネスの配線 + degraded mode |
| `docs/phase3-write-paths.md` | 5 つの書き込み経路 + 蒸留／検疫 |
| `docs/phase4-coverage-matrix.md` | 20 経路カバレッジマトリクス + 検証レイヤー |
| `docs/phase5-librarian.md` | Letta ライブラリアン handoff レーン（single-writer キュレーション） |
| `docs/phase6-remote.md` | 正本ストアの sov 移行 + ssh stdio-MCP アクセス |
| `docs/onboarding.md` | **新規エージェント参加手順（5 分）** |
| `docs/handoff-tailscale-connectivity.md` | ストア接続（Tailscale/LAN）問題 + 自動フォールバック handoff プロンプト |

## 主要コマンド

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # 共有コンテキストブロックを出力
node scripts/record-fact.mjs --type decision "..."   # 明示的記録（秘密情報は exit 3 で遮断）
node scripts/distill-session.mjs --file <transcript> # セッション蒸留 + 検疫スイープ
node scripts/librarian-sync.mjs [--strict]           # outbox → sov ライブラリアン inbox 配送 (Phase 5)
node scripts/doctor.mjs                              # 配線セルフチェック
node scripts/cross-verify.mjs                        # 20 経路カバレッジマトリクス再実行
node scripts/reexplain.mjs log|report                # 再説明の計測（2 週間ゲート補助指標）
node --test 'tests/*.test.mjs'                       # 全テスト (73)
```

## 2 週間実使用ゲート（進行中）

シナリオテストはすべて通過済み。最終合格は、**2 週間の実使用で「また説明している」という感覚が消えたか**をユーザーが確認して判定する。再説明が発生するたびに `reexplain.mjs log` で記録し、2 週間後に `report` の週次トレンドがゼロに収束するかを見る。

## クレジット

**[GJC (Gajae Code)](https://github.com/Yeachan-Heo/gajae-code)** — AI コーディング
エージェント — とともに最初から最後まで構築した。ストアの各フェーズ、5 言語 README の
ナラティブスタイル、そして上のプロモアニメーションまで、GJC が実装・検証・出荷した —
構築中に UAC 自身の共有メモリを使いながら。
