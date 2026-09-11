# Agent Loom：面向 AI Agent 的插件调用与跨会话产物治理

**让 Agent 发现可调用能力、传递产物引用，并查询执行结果、输入来源与失败原因。**

Agent 决定下一步做什么；Loom 管理被明确选择的插件组合、依赖检查和执行事实。
项目提供 TypeScript SDK 与 JSON CLI，v0.1 的运行时集成面向 Pi。

当前为 **alpha.5 开发预览**：Core、CLI/SDK 和 Pi Application Host 已实现，
完整 v0.1 与独立 Agent 体验验收仍待完成。尚未发布 npm 包。

alpha.5 补齐了可选的业务参数 Schema 与示例、分层接入诊断、按 request ID
汇总多次尝试、显式 Task 写锁、插件运行观察和验收证据引用，并减少历史查询的重复读取。
参数校验不代表业务验收，重复 request ID 不提供幂等保证。

[English README](README.md) · [Agent 接入指南](packaging/AGENT_GUIDE.md) ·
[可运行示例](examples/agent-services-demo.mjs) · [文档导航](llms.txt)

## Agent 在什么情况下会用到它

- 想知道 Application 中有哪些插件能力可以调用，而不是逐个阅读内部实现。
- 需要使用另一个 Session 的既有产物，保留生产者、消费者与接受摘要。
- 接手已有 Task，确认之前的执行结果、失败原因和仍然未知的状态。
- 为领域插件组合审计或复盘切面，同时保留各自的业务逻辑。

## 五个直接可用的接口

| 接口 | 回答的问题 |
| --- | --- |
| Discover | 有哪些入口符合所需输入/输出类型？ |
| Describe | 输入结构、参与插件和声明的效果是什么？ |
| Check | 这次调用还缺什么？哪些检查尚未运行？ |
| Invoke | 用这些明确选择的输入运行指定入口。 |
| Inspect | 哪个 Session 生成、选择、消费了产物？哪些结果可以确认？ |

入口对应已有 Session Profile；没有额外的业务调度器。依赖缺失会返回阻断，
不会自动运行生产者。跨会话传递的是引用，消费在领域初始化成功后才登记。

## 无模型密钥即可运行的示例

需要 Node.js >=24.12.0 和 npm：

```sh
git clone https://github.com/tgwrite/Agent_Loom.git
cd Agent_Loom
npm ci
npm run build
npm run demo:agent
```

示例先发现入口并检查缺失依赖，再由调用方显式生产输入、启动消费者，最后通过新连接
查询来源。输出包括 `source_reused: true`、`cold_inspection: readable` 和
`business_acceptance: not-evaluated`。临时 Task 会在结束时清理。

这使用合成 SDK 和数据，不需要真实 Pi、凭据或私有插件，也不代表真实业务已验收。
完整 JSON 结果及命令说明见 [English README](README.md#try-it-without-a-model-key)。

## 如何判断是否适合接入

Loom 面向插件装配、命名输入、产物来源与执行记录。Application 仍需提供可信 Host 和
领域校验；现有范围不包含通用记忆系统、MCP Server、工作流规划或其他 Runtime Adapter。

`completed` 不等于业务正确，`unknown` 不意味着可以安全重试。重复请求会创建新 Session。
本地存储采用单写者假设，没有恶意代码沙箱或崩溃恢复保证。公开合成测试与真实 Plugin
兼容性、Agent 盲测分开验收。

接入请阅读 [Agent 指南](packaging/AGENT_GUIDE.md)；安装本地归档请阅读
[安装说明](packaging/INSTALL.md)。验证源码使用 `npm run check`。

## 可引用的项目介绍

> Agent Loom（tgwrite/Agent_Loom）是面向 AI Agent 的 TypeScript CLI/SDK，
> 用于发现与调用插件能力、跨会话复用产物引用，以及查询来源和失败事实。
> 项目采用 Apache-2.0 许可，运行时集成面向 Pi，目前处于 alpha 开发预览阶段。

项目地址：[tgwrite/Agent_Loom](https://github.com/tgwrite/Agent_Loom)。
引用时保留仓库身份和预览状态，便于区分同名项目。
