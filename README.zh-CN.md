# Agent Loom：最小 Agent 治理运行时

**根据声明的证据条件，决定一次 Agent 工作是否具备继续执行的资格。**

模型选择工作；领域插件产生并验证事实；Loom 记录事实来源、精确消费和持久化执行结果。
核心概念收敛为 Task、Run、Artifact、Requirement、Consumption。提供 TypeScript SDK
与 JSON CLI，运行时接入面向 Pi。

[使用手册](manual/README.md) · [下载预发布版](https://github.com/tgwrite/Agent_Loom/releases) ·
[English](README.md) · [Agent 文档导航](llms.txt)

## 治理闭环

| 核心概念 | 含义 |
| --- | --- |
| Task | 固定一次工作的治理上下文和 Application 快照 |
| Run | 一次明确选择的执行；CLI 和存储仍称 Session |
| Artifact | 带生产者、Run、原始引用和 digest 的产物 |
| Requirement | 执行所需的证据条件，可以指定生产者 |
| Consumption | consumer 初始化时接受了某个精确 Artifact 和 digest 的事实 |

`声明条件 → 唯一匹配证据 → consumer 初始化验证 → 持久化消费 → 执行`

例如：author 产生结果，verifier 产生普通 Proof Artifact，下游 Run 同时要求两者，
并通过 `producer_plugin_id` 指定 proof 的生产者。缺少证据时阻止执行，多匹配时要求
明确绑定。consumer 必须验证 proof 对应的结果、digest 和 verdict；`assertion.status`
只是生产者声明。见[结果与独立 proof 配置示例](manual/ADAPTER_API.md#require-a-result-and-independent-proof)。

每个 Run 最多选择一个主领域插件及可选切面。模型选择工作，插件保留领域工具、守卫与
验证逻辑。Discover / Describe / Check 是便利接口；Invoke 重新检查证据，Check 通过
不代表预留了输入，也不能绕过 consumer 初始化。

## 安装与使用

**当前预发布版本：0.2.0-alpha.1。** 从 [GitHub Releases](https://github.com/tgwrite/Agent_Loom/releases)
下载预编译 `.tgz`、`SHA256SUMS` 和 `INSTALL.md`，按[安装手册](manual/INSTALL.md)使用。Loom 要求 Node.js >=24.12.0
与 npm；升级前阅读[破坏性变更和迁移说明](manual/AGENT_GUIDE.md#compatibility-and-migration)。

在源码仓库中体验无需原生依赖的流程：

```sh
npm ci
npm run check
npm run demo:agent
npm run package:local
```

demo 使用合成 Host，不调用模型。打包命令输出本地归档路径，并在同目录生成校验文件。
安装归档后，按[首个 Task 演示](manual/START_HERE.md#3-check-the-complete-lifecycle-without-native-dependencies)
观察证据不足、产物产生和成功消费的过程。

具体操作统一放在 **[使用手册](manual/README.md)**：

- [安装与版本确认](manual/INSTALL.md)
- [快速开始与接入路径](manual/START_HERE.md)
- [完整原生应用开发教程](manual/NATIVE_INTEGRATION.md)
- [Application 与适配器 API](manual/ADAPTER_API.md)
- [结果检查与故障排查](manual/TROUBLESHOOTING.md)

手册面向通用应用接入，不绑定某个插件组合。应用负责提供原生插件、Host、模型配置与
领域校验；教程使用公开 API，避免要求使用者从框架或测试实现反推接口。

## 当前边界

Core、CLI/SDK 和 Pi Application Host 已实现，真实插件兼容与独立 Agent 体验验收仍需单独验证。
证据缺失报 `PreconditionNotSatisfied`，多匹配报 `BindingConflict`，不会启动生产者。
Proof 是普通 Artifact；其 subject、digest 和 verdict 由 consumer 验证。`assertion.status`
只表示生产者声明。Loom 控制经过可信 Host 的入口，不是绕过入口的代码沙箱或权限系统。
Task schema 3 拒绝旧数据，保留历史原样，要求显式迁移。
`completed` 不等于业务正确，`unknown` 不代表可以安全重试。
当前不提供工作流规划、自动重试、数据库或恶意代码沙箱；合成示例不证明原生兼容性。

开发与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。
接口变化见[高级契约与兼容性](manual/AGENT_GUIDE.md)。

许可证：[Apache-2.0](LICENSE)。项目地址：
[tgwrite/Agent_Loom](https://github.com/tgwrite/Agent_Loom)。
