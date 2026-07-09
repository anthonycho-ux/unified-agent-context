# Unified Agent Context

[English](README.md) | [한국어](README.ko.md) | **中文** | [日本語](README.ja.md) | [Español](README.es.md)

每一次新的 AI 对话都从失忆开始。昨天你告诉 Claude 你的 README 默认用英文，
今天早上 Codex 又问了一遍，今晚第三个助手还会再问。你用着五个 AI 智能体，
而它们唯一共享的记忆就是你自己——你正在被一次次的重复解释慢慢消耗。

**Unified Agent Context 终结了这一切。** 只需对任何一个智能体说一次决定——
claude code、codex、hermes、gajaecode、lettacode——其他每个智能体在下一次会话
中就都知道了。全自动、跨设备，并且密钥从设计上就被挡在门外。

![UAC demo](artifacts/promo/uac-promo.gif)

## 架构（权威存储 = sov，设备无关访问）

```
Agents ──(MCP stdio, over ssh when remote)──► mcp-memory-keeper (canonical: sov ~/.uac/data/memory)
   │  ▲
   │  └─ Session start: inject distilled facts only (hook or instructed pull) — scripts/inject-context.mjs
   └──── During session: explicit record (record-fact) / on exit: auto-distill (distill-session)
              └─ Every write path goes through a central fail-closed secret gate (block or redact)
              └─ Permanent facts queue into the librarian outbox → librarian-sync delivers to the
                 sov Letta "The Noticer" inbox (Phase 5)
```

- 作用域：`global`（偏好）vs `project:<git-root-basename>`（决策/工作状态）——阻止跨项目泄漏（由服务端查询强制执行）
- TTL：decision/preference 永久保留，project_state 保留 90 天
- 原始对话仅进入冷归档（绝不注入；密钥只做脱敏处理）
- 降级模式：服务器不可达时发出 4 类证据（warning/log/health/metric）；`UAC_STRICT=1` 时转为硬失败
- 设备无关：权威存储位于 sov——其他机器（如 Mac）通过 `uac.config.json` 配置的 ssh 派生进程访问（Phase 6）
- v2 计划：离线本地队列 + 重新同步 / 自托管远程 MCP + 认证 → 接入 claude.ai

## 文档

| 文档 | 内容 |
|------|------|
| `docs/phase0-comparison.md` | 存储候选对比 + 采纳依据 |
| `docs/phase1-storage.md` | Schema / 作用域 / TTL / 密钥门 |
| `docs/phase2-hooks.md` | 5 个运行框架的接线 + 降级模式 |
| `docs/phase3-write-paths.md` | 5 条写入路径 + 蒸馏/隔离 |
| `docs/phase4-coverage-matrix.md` | 20 路径覆盖矩阵 + 验证层级 |
| `docs/phase5-librarian.md` | Letta 图书管理员移交通道（single-writer 策展） |
| `docs/phase6-remote.md` | 权威存储迁移至 sov + ssh stdio-MCP 访问 |
| `docs/onboarding.md` | **新智能体接入流程（5 分钟）** |
| `docs/handoff-tailscale-connectivity.md` | 存储连接（Tailscale/LAN）问题 + 自动回退移交提示词 |

## 常用命令

```sh
node scripts/inject-context.mjs [--cwd <dir>]        # 输出共享上下文块
node scripts/record-fact.mjs --type decision "..."   # 显式记录（含密钥时以 exit 3 拒绝）
node scripts/distill-session.mjs --file <transcript> # 会话蒸馏 + 隔离清扫
node scripts/librarian-sync.mjs [--strict]           # outbox → sov 图书管理员 inbox 投递 (Phase 5)
node scripts/doctor.mjs                              # 接线自检
node scripts/cross-verify.mjs                        # 重跑 20 路径覆盖矩阵
node scripts/reexplain.mjs log|report                # 重复解释度量（2 周验收辅助指标）
node --test 'tests/*.test.mjs'                       # 全部测试 (73)
```

## 2 周实际使用验收（进行中）

所有场景测试均已通过。最终验收由用户判定：**在 2 周的实际使用中，"再解释一遍"的感觉是否消失？** 每次发生重复解释时用 `reexplain.mjs log` 记录；2 周后查看 `report` 的周趋势是否收敛到零。

## 致谢

与 **[GJC (Gajae Code)](https://github.com/Yeachan-Heo/gajae-code)**（一个 AI
编程智能体）从头到尾共同构建：存储各阶段、五种语言 README 的叙事风格、以及上方的
宣传动画，均由 GJC 实现、验证并交付——而且在构建过程中就使用了 UAC 自己的共享记忆。
