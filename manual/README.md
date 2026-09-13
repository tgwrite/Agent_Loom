# Agent Loom 使用手册 / User manual

面向使用 Loom 的 Agent 和应用开发者。README 介绍项目；这份手册负责安装、接入、
运行和排错。Loom 根据声明的证据控制执行资格，记录来源、消费与执行事实；模型选择
工作，领域插件判断事实。按下面的顺序阅读，无需通过框架或测试实现反推 Loom 接口。

适用 API：**0.2.0-alpha.1，尚未发布的开发候选**。原生教程固定使用 Pi **0.85.1**。
0.2.0-alpha.1 本地候选安装包包含本目录，安装后可在 `node_modules/agent-loom/manual/` 离线阅读。
旧版使用者先阅读[破坏性变更与 Task schema 3 迁移说明](AGENT_GUIDE.md#compatibility-and-migration)。
旧 Task 不会自动升级，也不能通过直接修改 schema 数字恢复运行。

## 阅读路径

| 章节 | 解决的问题 |
| --- | --- |
| [1. 安装](INSTALL.md) | 获取归档、校验、项目内安装、版本确认和卸载 |
| [2. 快速开始](START_HERE.md) | 选择调用/开发路径，跑通无模型流程，明确框架与应用的分工 |
| [调用已有应用：CLI 与 SDK](AGENT_API.md) | 请求字段、检查与调用顺序、SDK Host 绑定、选择产物与读取结果 |
| [3. 原生应用开发教程](NATIVE_INTEGRATION.md) | 从空应用目录创建完整 Application、Host、适配器和模型配置，调用真实 Pi 工具 |
| [4. Application 与适配器 API](ADAPTER_API.md) | 字段、注册、生命周期参数、返回值、跨 Session 输入和扩展其他插件 |
| [5. 结果检查与故障排查](TROUBLESHOOTING.md) | 判断阻碍属于哪一层、检查产物和切面、处理未知状态 |
| [6. 高级契约与兼容性](AGENT_GUIDE.md) | Schema 子集、请求/回执、写锁、观察证据和版本变化 |

## 五个概念

| 概念 | 使用时要确认什么 |
| --- | --- |
| Task | 使用哪份固定的 Application 快照 |
| Run | 明确执行哪个 Profile/Entry；命令中仍叫 Session |
| Artifact | 谁、哪次执行产生了它，原始引用和 digest 是什么 |
| Requirement | 需要哪类证据，是否限定生产者和精确产物 |
| Consumption | consumer 是否已成功初始化并接受这些精确证据 |

首次安装从第 1 → 2 章开始。第 2 章先演示缺少证据的阻碍，再运行生产者和消费者。
需要独立验证者的应用，继续阅读[结果与 proof 配置](ADAPTER_API.md#require-a-result-and-independent-proof)。
已有 Loom 应用的调用方从第 2 章开始，再读该应用自己的入口契约。
开发新应用的 Agent 按第 2 → 3 → 4 → 5 章推进。第 6 章是查询参考，不必先读完。

## What this manual promises

The tutorials supply all required application files and use public imports.
The API reference states which inputs, callbacks and outputs the application owns.
The native tutorial uses a small teaching plugin so its integration is inspectable
from the documentation; it is not tied to a web/report/monitoring/review combination.

For a different native plugin, use that plugin's documented entry, tools/commands
and output contract. Loom does not manufacture a domain adapter or guarantee
compatibility with every npm package. Missing native documentation is a specific
integration prerequisite, not an instruction to guess interfaces or read implementation.

## Validation boundaries

Installation, static validation, native resource readiness, confirmed execution,
artifact consumption and domain proof verification are separate checks. Each tutorial
states its expected observations. Synthetic demonstrations do not establish native
compatibility or business quality. See chapter 5 before retrying a failed operation.

This directory is the source of the public and packaged manual. Contributor-only
experiments remain outside the user reading path.
