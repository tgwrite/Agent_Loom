# Agent Loom 使用手册 / User manual

面向使用 Loom 的 Agent 和应用开发者。README 介绍项目；这份手册负责安装、接入、
运行和排错。按下面的顺序阅读，无需通过框架、插件或测试实现反推 Loom 接口。

适用 API：**0.1.0-alpha.7**。原生教程固定使用 Pi **0.85.1**。
alpha.7 安装包包含本目录，安装后可在 `node_modules/agent-loom/manual/` 离线阅读。
alpha.6 使用者仍可参考基础接入步骤；新增诊断和摘要字段需要升级到 alpha.7。

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
artifact consumption and business acceptance are separate checks. Each tutorial
states its expected observations. Synthetic demonstrations do not establish native
compatibility or business quality. See chapter 5 before retrying a failed operation.

This directory is the source of the public and packaged manual. Contributor-only
experiments remain outside the user reading path.
