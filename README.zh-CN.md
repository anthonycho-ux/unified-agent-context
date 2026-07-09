# Unified Agent Context

[English](README.md) | [한국어](README.ko.md) | **中文** | [日本語](README.ja.md) | [Español](README.es.md)

每一次新的 AI 对话都从失忆开始。昨天你告诉 Claude 你的 README 默认用英文，
今天早上 Codex 又问了一遍，今晚第三个助手还会再问。你有五个智能体，
它们唯一共享的记忆就是你。你正在被一次次的重复解释慢慢消耗。

**Unified Agent Context 终结了这一切。** 只对任何一个智能体说一次。
其他每个智能体在下一次会话里就都知道了。全自动，跨设备，密钥被挡在门外。

![UAC 27秒演示](artifacts/promo/uac-promo.gif)

## 它如何工作

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: store-host ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 store-host Letta "The Noticer" inbox (Phase 5)
```

用大白话说。

- 所有智能体读写同一份共享记忆。
- 偏好走到哪跟到哪，项目决定只留在项目里。
- 决定和偏好永久保存，日常工作状态 90 天后过期。
- 原始对话不会被注入会话，它们只进冷归档，密钥在入库时就被清除。
- 每次写入都要过一道密钥闸门，钥匙和密码默认被拦下。
- 存储连不上时，智能体会大声说出来，不会悄悄糊弄。
- 主存储在一台叫 store-host 的家用服务器上，其他机器通过 ssh 访问。

## 文档

| 文档 | 讲什么 |
|------|--------|
| `docs/phase0-comparison.md` | 我们选了哪个存储，为什么。 |
| `docs/phase1-storage.md` | 数据结构，作用域，保留期限，密钥闸门。 |
| `docs/phase2-hooks.md` | 五个智能体各自是怎么接进来的。 |
| `docs/phase3-write-paths.md` | 事实写入的五条路，以及蒸馏和隔离。 |
| `docs/phase4-coverage-matrix.md` | 二十条传递路径，全部测试验证。 |
| `docs/phase5-librarian.md` | 管理永久事实的图书管理员通道。 |
| `docs/phase6-remote.md` | 主存储搬到 store-host，以及 ssh 访问。 |
| `docs/onboarding.md` | 新智能体五分钟加入的方法。 |
| `docs/handoff-tailscale-connectivity.md` | 存储连接不稳时怎么办。 |

## 命令

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # 输出共享上下文块
node scripts/record-fact.mjs --type decision "..."   # 显式记录（含密钥时以 exit 3 拒绝）
node scripts/distill-session.mjs --file <transcript> # 会话蒸馏 + 隔离清扫
node scripts/librarian-sync.mjs [--strict]           # outbox → store-host 图书管理员 inbox 投递 (Phase 5)
node scripts/doctor.mjs                              # 接线自检
node scripts/cross-verify.mjs                        # 重跑 20 路径覆盖矩阵
node scripts/reexplain.mjs log|report                # 重复解释度量（2 周验收辅助指标）
node --test 'tests/*.test.mjs'                       # 全部测试 (73)
```

## 两周测试

所有场景测试都通过了。真正的测试是这个。两周日常使用后，你是否还会把同一句话
说第二遍。每次重复就用 `reexplain.mjs log` 记一笔。周计数降到零，UAC 就成功了。

## 致谢

与 **[GJC, Gajae Code](https://github.com/Yeachan-Heo/gajae-code)**，一个 AI
编程智能体，一起从头到尾构建。存储各阶段，五种语言 README 的叙事风格，
还有上面的宣传动画，都由 GJC 实现，验证并交付。构建过程中它用的就是 UAC
自己的共享记忆。
