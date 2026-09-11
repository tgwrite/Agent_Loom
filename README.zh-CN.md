# Agent Loom：面向 AI Agent 的插件调用与跨会话产物治理

**让 Agent 发现可调用能力、传递产物引用，并查询执行结果、输入来源与失败原因。**

Agent 决定下一步做什么；Loom 管理明确选择的插件组合、依赖检查和执行事实。
项目提供 TypeScript SDK 与 JSON CLI，当前运行时集成面向 Pi。

[使用手册](manual/README.md) · [下载安装包](https://github.com/tgwrite/Agent_Loom/releases) ·
[English](README.md) · [Agent 文档导航](llms.txt)

## 主要能力

| 接口 | 用途 |
| --- | --- |
| Discover / Describe | 发现入口，读取输入、输出和参与插件的契约 |
| Check | 检查依赖与接入前置条件 |
| Invoke | 执行明确选择的入口 |
| Inspect | 查询执行结果、产物来源、消费记录和失败事实 |

一个 Task 可以关联多个 Session；每个 Session 选择一个主领域插件和可选切面。
跨 Session 传递产物引用，消费者验证输入并成功初始化后才登记消费。
领域工具、校验规则和复盘逻辑仍由插件负责。

## 安装与使用

**当前版本：0.1.0-alpha.7 开发预览。** 从
[GitHub Releases](https://github.com/tgwrite/Agent_Loom/releases) 下载预编译 `.tgz`、
`SHA256SUMS` 和安装说明。Loom 要求 Node.js >=24.12.0 与 npm，原生插件可能要求更高版本。
尚未发布 npm registry 包。

具体操作统一放在 **[使用手册](manual/README.md)**：

- [安装与版本确认](manual/INSTALL.md)
- [快速开始与接入路径](manual/START_HERE.md)
- [完整原生应用开发教程](manual/NATIVE_INTEGRATION.md)
- [Application 与适配器 API](manual/ADAPTER_API.md)
- [结果检查与故障排查](manual/TROUBLESHOOTING.md)

手册面向通用应用接入，不绑定某个插件组合。应用负责提供原生插件、Host、模型配置与
领域校验；教程使用公开 API，避免要求使用者从框架或测试实现反推接口。

## 当前边界

Core、CLI/SDK 和 Pi Application Host 已实现，完整 v0.1 与独立 Agent 体验验收仍待完成。
依赖缺失不会自动启动生产者，`completed` 不等于业务正确，`unknown` 不代表可以安全重试。
当前不提供工作流规划、自动重试、数据库或恶意代码沙箱；合成示例不证明原生兼容性。

开发与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。
接口变化见[高级契约与兼容性](manual/AGENT_GUIDE.md)。

许可证：[Apache-2.0](LICENSE)。项目地址：
[tgwrite/Agent_Loom](https://github.com/tgwrite/Agent_Loom)。
