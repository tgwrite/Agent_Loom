# Agent Plugin Application Container v0.1 实施基线

**版本：** v0.1

**Reference Runtime：** Pi

**Reference Plugins：** C2Forge / C2Decoder / Postmortem

**阶段目标：** 用真实三个 Plugin 验证 Container 是否能够降低 Plugin 组合与任务治理成本，而不是先构建完整 Agent Framework。

**公开版说明：** 本文保留设计输入与目标；关于 Reference Plugin 现状的描述不代表本公开仓库已完成兼容性验证。真实仓库位置、私有 revision、本机路径和 Case 数据不随本项目公开，实际进度见 `docs/REFERENCE_BASELINE.md` 与 `docs/ACCEPTANCE.md`。

---

# 1. 项目目标

Agent Plugin Application Container v0.1 的目标不是重新实现 Agent、Agent Loop 或 Plugin Framework。

它只解决当前已经真实出现的一个问题：

> **当多个 Agent Plugin 开始共同参与一个业务任务时，将原本散落在 Plugin 代码、Pi Hook、文件路径、Session、人工操作和隐式约定中的关系，上移为统一、显式、可追踪的 Application 与 Task 治理语义。**

当前已经存在三个实际 Plugin：

- C2Forge：领域 Plugin；
- C2Decoder：领域 Plugin；
- Postmortem：横切 Plugin。

当前真实执行关系为：

```text
一个业务 Task / Case
        │
        ├── Pi Session #1
        │      Agent
        │      +
        │      C2Forge
        │      +
        │      Postmortem
        │
        │      ↓
        │   Decoder Handoff
        │
        └── Pi Session #2
               Agent
               +
               C2Decoder
               +
               Postmortem
```

C2Forge 当前已经能够发布稳定的 Decoder Handoff；C2Decoder 已经将上游 READY Handoff 作为生产入口，而不是直接调用 C2Forge。

Postmortem 当前已经能够与两个领域 Plugin 共存，并通过独立 sidecar 在不污染主 Agent Context 的情况下进行 checkpoint reflection。

因此 v0.1 的核心任务不是发明这些关系，而是：

> **把这些已经存在但分散实现的关系组织起来。**

---

# 2. v0.1 最终价值判断

v0.1 是否成功，不以代码量、Primitive 数量或者“像不像 Spring”判断。

唯一核心标准是：

> **Container 是否真正服务现有 Plugin，使开发者减少任务治理和 Plugin glue 工作，从而把主要精力重新投入领域能力质量。**

对当前项目而言，Container 应该帮助开发者减少以下工作：

```text
手工确认应该加载哪些 Plugin
手工组织 C2Forge + Postmortem
手工组织 C2Decoder + Postmortem

手工寻找上游 Handoff 路径
手工判断某个产物属于哪个 Session / Task
手工维护 C2Forge → C2Decoder 的跨 Session 关系

手工记录一次任务经历过哪些 Session
手工追踪哪个 Agent / Plugin 产生了哪个产物

每个横切 Plugin 分别直接适配 Pi lifecycle
重复处理 Session / Event / Failure / Context 隔离问题
```

Container 不负责提高：

```text
C2 发现准确率
Decoder 泛化效果
YARA 质量
Postmortem 推理质量
```

这些仍然属于 Plugin。

Container 的作用是：

> **让开发者有更多时间优化这些业务领域问题，而不是继续维护 Plugin 之间的关系代码。**

---

# 3. v0.1 核心设计原则

## 3.1 Existing Plugin First

v0.1 不要求 C2Forge、C2Decoder、Postmortem 重写为 Container Plugin。

三个现有 Plugin 应首先作为：

```text
Native Pi Plugin
+
Compatibility Adapter / Descriptor
```

接入 Container。

第一阶段验收应尽可能做到：

> **三个现有 Plugin 的领域业务代码零修改。**

如果必须修改，也只能接受：

- Pi 版本兼容修复；
- 极薄 integration hook；
- 明确证明现有 Plugin 缺少一个无法从外部适配的能力。

不得为了符合 Container API 重构 Domain Core。

---

## 3.2 Container 不拥有业务事实

例如：

```text
DecoderHandoff 是否真正可信
```

仍然由 C2Forge / C2Decoder 当前验证机制决定。

Container 只管理：

```text
Artifact 是什么
在哪里
谁产生
属于哪个 Task
来自哪个 Session
验证状态是什么
```

因此：

```text
Container = Dependency Resolution

Plugin = Domain Trust / Verification
```

---

## 3.3 Dependency Graph ≠ Execution Graph

Container 可以声明：

```text
C2Decoder requires
DecoderHandoffView V3
READY
```

但 Artifact 缺失时：

```text
PreconditionNotSatisfied
```

不得：

```text
自动启动 C2Forge
```

否则 Container 会逐渐成为 Workflow Engine。

谁决定下一步执行 C2Forge 或 C2Decoder，仍然属于：

```text
User
Agent
Runtime
未来的 Orchestrator
```

---

## 3.4 Plugin Context ≠ Agent Context

Container 自己产生的：

```text
Task metadata
Session lineage
Artifact registry
Event records
Plugin private state
```

默认不得自动进入主 LLM Context。

只有显式 Effect 才允许改变 Agent Context。

Postmortem 当前的 sidecar 隔离行为应作为 v0.1 的 Reference Isolation Model。其 checkpoint 调用使用独立 system prompt、空 tools，并且 checkpoint response 不进入普通 Agent Context。

---

# 4. v0.1 世界模型

v0.1 使用以下七个核心概念：

```text
Application
Task
Session Run
Actor
Capability
Artifact
Event
```

其中真正的三种 Plugin 关系仍然是：

```text
Capability = DO
谁可以做什么

Artifact = HAVE
任务已经产生了什么

Event = HAPPENED
一次执行过程中发生了什么
```

另外：

```text
Actor = WHO
谁在执行

Session Run = EXECUTION
哪一次 Agent Runtime 执行

Task = BUSINESS BOUNDARY
这些 Session 属于哪一个共同业务任务
```

---

# 5. Scope 模型

## 5.1 Application Scope

描述一个 Application 由哪些 Plugin 组成。

例如：

```text
C2 Analysis Application

plugins:
    c2forge
    c2decoder
    postmortem
```

Application 是静态定义。

---

## 5.2 Task Scope

Task 是跨 Session 的业务治理单位。

例如：

```text
Task:
分析 malware cluster X，
证明 Seed Decoder，
并迁移到同簇样本。
```

一个 Task 可以拥有多个 Session Run：

```text
Task
│
├── C2Forge Session
│
└── C2Decoder Session
```

Task 持有：

```text
Task Identity
Artifact Registry
Session Index
Provenance
```

---

## 5.3 Session Run

Session Run 映射一次实际 Agent Session。

v0.1 采用强约束：

> **一个 Session Run 最多一个 Primary Domain Plugin，可以同时存在多个横切 Plugin。**

例如：

```text
Session Profile: c2forge

Primary:
    C2Forge

Aspects:
    Postmortem
```

以及：

```text
Session Profile: c2decoder

Primary:
    C2Decoder

Aspects:
    Postmortem
```

---

# 6. v0.1 Session Profile

增加一个轻量 `SessionProfile` 概念。

它不是新的 Kernel Primitive，而是 Application Composition 配置。

例如：

```text
c2forge-profile
    primary: c2forge
    aspects:
        - postmortem
```

```text
c2decoder-profile
    primary: c2decoder
    aspects:
        - postmortem
```

Container 根据 Profile 决定当前 Pi Session 应加载哪些 Native Plugin。

这样开发者不再需要每次人工组合：

```text
C2Forge + Postmortem
```

或者：

```text
C2Decoder + Postmortem
```

---

# 7. Capability v0.1

Capability 表示：

> **某个组件能够执行的行为。**

v0.1 只实现最基础语义：

```text
CapabilityDefinition

id
version
provider
requirements
```

Container 支持：

```text
Capability → single Provider
```

多个 Provider 同时满足时：

```text
BindingConflict
```

第一版不做自动 provider selection。

现有 C2Forge / C2Decoder 的 Pi tools 第一阶段可以继续原样注册。

Container 不要求立刻将所有 Pi Tool 重写成 Capability API。

v0.1 主要建立 Capability 的描述与治理模型，为后续迁移 Host API 做准备。

---

# 8. Artifact v0.1

Artifact 是 v0.1 最优先实现的 Primitive。

定义：

> **Artifact 是具有 Contract、Provenance 和 Verification Metadata 的 Task-scoped 产物。**

Artifact 是：

```text
Task-scoped
Session-produced
```

最小结构：

```text
ArtifactRecord

id
type
version

task_id

producer:
    plugin_id
    capability_id
    session_id

executor:
    actor_id
    runtime_id

verification:
    status

payload_ref
sha256

created_at
```

v0.1 不建立新的大型 Artifact Store。

支持：

```text
small metadata
    → inline

existing business artifact
    → filesystem reference
```

Container 不复制 C2Forge 原始 Handoff。

只记录其：

```text
path
digest
producer
session
task
verification
```

---

# 9. 第一个核心闭环：C2Forge → C2Decoder

这是 v0.1 最重要的价值验证。

现状：

```text
C2Forge Session
    ↓
hand-off file
    ↓
开发者找到路径
    ↓
初始化 C2Decoder
    ↓
新 Session
```

v0.1：

```text
C2Forge Session
        ↓
existing Handoff publication
        ↓
C2Forge Compatibility Adapter
        ↓
Artifact Registry

DecoderHandoffView V3
        ↓
Task keeps ArtifactRef
        ↓

C2Decoder Session start
        ↓
Container resolves requirement
        ↓
ArtifactRef
        ↓
现有 C2Decoder initializer
```

C2Decoder 仍然自己验证：

```text
Handoff
transaction
publication receipt
Seed identity
digest
```

这些逻辑不得进入 Container。

---

# 10. Event v0.1

Event 表示：

> **某一次 Session 中已经发生的事实。**

Event 默认：

```text
Session-scoped
Task-correlated
```

最小 Envelope：

```text
EventEnvelope

id
type
timestamp

task_id
session_id
actor_id

source
correlation_id

payload
```

Container Core Events 第一版只保证：

```text
session.started
session.completed
session.failed

capability.started
capability.completed
capability.failed

artifact.published
```

Pi Runtime Adapter 可以额外映射：

```text
runtime.agent.*
runtime.turn.*
runtime.tool.*
runtime.compaction.*
runtime.session.*
```

---

# 11. Postmortem 的 v0.1 接入方式

v0.1 不立即重写 Postmortem。

Postmortem 仍然可以直接使用现有 Pi Hook。

现有代码已经监听多个 Pi 生命周期事件，包括 compaction、turn、agent settled、tool call 和 session navigation。

现有测试也已经验证它能够与 C2Forge 和 C2Decoder 共存，并保持领域 Guard 和 sidecar isolation。

因此第一阶段：

```text
Pi
├── Domain Plugin
├── Postmortem
└── Container Bridge
```

三者并存。

Container Bridge 负责记录公共 Event Stream。

Postmortem 继续当前实现。

第二阶段再验证：

> 哪些 Pi Hook glue 可以从 Postmortem 中抽离，统一由 Container Event Adapter 提供。

---

# 12. Runtime Adapter v0.1

Reference Runtime：

```text
Pi
```

v0.1 不支持 Codex / Claude / DeepSeek Harness。

但是 Core API 不直接依赖 Pi。

结构：

```text
container-core
        ↑
runtime contract
        │
runtime-pi
        │
        ▼
       Pi
```

Runtime Adapter 第一版只需要覆盖三个真实 Plugin 已经使用的最小 Host Surface。

## Execution

```text
exec
```

## Agent Exposure

```text
register capability/tool
register user command
```

## Sidecar

```text
isolated model completion
```

## Runtime Event

```text
session
agent
turn
tool
compaction
```

## Limited Effect

```text
system policy contribution
temporary context overlay
```

不得试图把完整 Pi API 抽象一遍。

---

# 13. Reference Pi Baseline

当前仓库存在版本差异：

C2Forge Pi Adapter 和 C2Decoder 开发依赖目前仍固定在 Pi 0.84.4。

Postmortem 当前明确要求：

```text
Pi >=0.85.1 <0.86.0
```



因此 v0.1 建议：

> **Reference Host Target = Pi 0.85.1**

但必须首先执行 C2Forge / C2Decoder 的兼容性回归。

如果存在兼容问题，只允许进行最小兼容修复，不进行 Container 化重构。

---

# 14. v0.1 项目骨架

```text
agent-plugin-application-container/
│
├── packages/
│   │
│   ├── container-core/
│   │   └── src/
│   │       ├── application/
│   │       ├── task/
│   │       ├── session/
│   │       ├── actor/
│   │       ├── plugin/
│   │       ├── capability/
│   │       ├── artifact/
│   │       ├── event/
│   │       ├── context/
│   │       ├── failure/
│   │       └── storage/
│   │
│   └── runtime-pi/
│       └── src/
│           ├── runtime-adapter.ts
│           ├── event-mapper.ts
│           ├── host-capabilities.ts
│           ├── session-bridge.ts
│           └── index.ts
│
├── adapters/
│   ├── c2forge-pi/
│   ├── c2decoder-pi/
│   └── postmortem-pi/
│
├── examples/
│   └── c2-analysis-application/
│       ├── application.ts
│       ├── profiles/
│       │   ├── c2forge.ts
│       │   └── c2decoder.ts
│       └── README.md
│
├── tests/
│   ├── composition/
│   ├── artifact-handoff/
│   ├── event-isolation/
│   ├── failure-containment/
│   └── e2e/
│
└── docs/
```

---

# 15. v0.1 第一批 Core Interface

只实现：

```text
ApplicationDefinition

PluginDescriptor
SessionProfile

TaskRecord
SessionRunRecord
ActorRef

CapabilityDefinition
CapabilityInvocation

ArtifactContract
ArtifactRecord
ArtifactRef

EventEnvelope

PluginContext

RuntimeAdapter

InvocationResult
ContainerFailure
```

暂不实现：

```text
Workflow Graph
Scheduler
Planner
Interceptor Chain
Policy Engine
RBAC
Distributed Container
Persistent Service State
Multi-Agent
Plugin Marketplace
Sandbox
```

---

# 16. Task 本地持久化

v0.1 不引入数据库。

在 Task Root 下创建：

```text
.agent-container/
│
├── task.json
│
├── artifacts.jsonl
│
├── sessions/
│   │
│   ├── <session-id>/
│   │   ├── session.json
│   │   └── events.jsonl
│   │
│   └── ...
│
└── invocations/
```

领域 Plugin 原有目录保持不变：

```text
.c2forge/
.c2decoder/
.agent-postmortem/
```

Container 只建立治理索引，不侵占领域目录所有权。

---

# 17. 实施阶段

## Phase 0：Reference Baseline Freeze

目标：

确保三个 Plugin 在统一 Pi baseline 下仍然正常工作。

工作：

```text
Pi 0.85.1 compatibility smoke test

C2Forge + Postmortem
C2Decoder + Postmortem

冻结三个仓库对应 commit
冻结真实测试 Case
```

交付：

```text
REFERENCE_BASELINE.md
compatibility test
three pinned plugin revisions
```

---

## Phase 1：Container Core Skeleton

实现：

```text
ApplicationDefinition
TaskRecord
SessionRun
Actor
ArtifactRecord
EventEnvelope
RuntimeAdapter interface
```

实现本地：

```text
.agent-container/
```

持久化。

这一步不接 Domain Plugin。

---

## Phase 2：Pi Runtime Bridge

实现一个独立 Pi Extension：

```text
Container Pi Bridge
```

负责：

```text
识别 Session

绑定 task_id

生成 session_id
记录 actor/runtime

监听基础 Pi lifecycle
写 events.jsonl

Session shutdown / failure settlement
```

不改变 Agent Prompt。

不改变 Domain Plugin。

不调用 LLM。

---

## Phase 3：C2Forge Artifact Adapter

实现：

```text
C2Forge Compatibility Adapter
```

观察现有 C2Forge Session。

发现：

```text
READY decoder_handoff_view.json
```

后建立：

```text
ArtifactRecord
```

必须保存：

```text
task
session
producer
payload_ref
digest
verification metadata
```

但不得重新判断 C2Forge Proof。

---

## Phase 4：C2Decoder Dependency Resolver

为 C2Decoder Profile 声明：

```text
requires:
    DecoderHandoffView V3
    READY
```

Session 启动前：

```text
resolve Artifact
```

如果不存在：

```text
PreconditionNotSatisfied
```

如果存在：

```text
得到真实 ArtifactRef
↓
调用现有 C2Decoder 初始化方式
```

不得自动启动 C2Forge。

---

## Phase 5：Session Profile Composition

实现：

```text
c2forge-profile

C2Forge
+
Postmortem
+
Container Bridge
```

以及：

```text
c2decoder-profile

C2Decoder
+
Postmortem
+
Container Bridge
```

开发者不再手工维护 Plugin 加载组合。

---

## Phase 6：Postmortem Event Governance Validation

第一轮不改 Postmortem 实现。

重点验证：

```text
Container event observer
+
Postmortem observer
```

同时存在是否安全。

验收：

```text
Postmortem sidecar 不进入主 Context

Postmortem failure 不影响 Domain Task

Decoder HOLDOUT Guard 不被破坏

C2Forge lifecycle 不被改变
```

---

## Phase 7：完整 E2E

真实执行：

```text
task create

↓
C2Forge Session
↓
C2Forge Handoff
↓
Artifact Registry
↓
C2Forge Session exit

↓
new C2Decoder Session
↓
resolve same Task Artifact
↓
C2Decoder executes

↓
Postmortem checkpoints
↓
Postmortem report
```

最后能够查询：

```text
这个 Task 有几个 Session？

每个 Session 用了哪个 Plugin？

由哪个 Actor 执行？

C2Decoder 使用的 Handoff 来自哪个 Session？

原始文件在哪里？

digest 是什么？

验证状态是什么？

这两个 Session 各自发生了哪些关键 Event？
```

---

# 18. v0.1 核心验收标准

## AC-01：三个 Plugin 不被框架绑架

目标：

```text
C2Forge Domain Core
C2Decoder Domain Core
Postmortem reflection logic
```

不得为了 Container 重构。

期望：

```text
Domain business diff = 0
```

允许：

```text
minimal Pi compatibility fixes
```

---

## AC-02：跨 Session Artifact 自动治理

C2Forge Session 退出之后：

```text
new C2Decoder Session
```

仍然能够通过：

```text
task_id
+
Artifact Contract
```

精确找到 Handoff。

开发者无需手工复制 Handoff 路径。

---

## AC-03：Precondition 明确

没有 READY Handoff：

```text
C2Decoder Session
```

不能正常进入 Domain execution。

返回结构化：

```text
PreconditionNotSatisfied
```

但不得自动执行 C2Forge。

---

## AC-04：完整 Provenance

给定任何 Decoder Handoff，可以回答：

```text
哪个 Task
哪个 Session
哪个 Agent Actor
哪个 Plugin
哪个 Capability
什么时候
产生了这个 Artifact
```

---

## AC-05：Postmortem 不污染业务任务

Checkpoint Reflection：

```text
不进入主 Agent Context
不改变 Domain Policy
不改变 Active Tools
```

Observer failure：

```text
不得导致 Domain Session failure
```

---

## AC-06：领域 Guard 保持原样

特别是 C2Decoder：

```text
HOLDOUT
tool guard
path policy
artifact trust
```

不得因为 Container 或 Postmortem 被绕过。

---

## AC-07：Session Composition 自动化

用户选择：

```text
profile=c2forge
```

自动得到：

```text
C2Forge + Postmortem + Container Bridge
```

选择：

```text
profile=c2decoder
```

自动得到：

```text
C2Decoder + Postmortem + Container Bridge
```

开发者不需要反复配置 Plugin 组合。

---

## AC-08：Task Governance 自动落盘

每个 Task 自动形成：

```text
task metadata
session lineage
artifact registry
event logs
```

而不是依靠人工记录。

---

# 19. “减轻治理负担”的可观察指标

v0.1 不只做技术测试，还要观察开发体验。

至少验证以下变化。

### Before

开发者需要关心：

```text
当前应该加载哪些 Plugin？

Postmortem 是否加载？

C2Forge Handoff 在哪个目录？

上一个 Session 是哪一个？

Handoff 是否属于当前 Case？

C2Decoder 应该读取哪个上游结果？

两个 Session 如何关联？

任务执行记录在哪里？
```

### After

开发者主要操作变成：

```text
选择 Task

选择 Session Profile

执行 Domain Task
```

Container 自动负责：

```text
组合
关联
索引
记录
解析
追踪
```

这才是 v0.1 真正要减少的认知负担。

---

# 20. v0.1 明确不做什么

即使实现过程中很容易顺手加入，也必须拒绝：

```text
自动 C2Forge → C2Decoder 工作流

DAG

Scheduler

自动选择下一个 Plugin

Agent Planner

多 Agent 编排

复杂 Permission Engine

完整 AOP Interceptor

Distributed Event Bus

数据库

Web UI

Plugin Marketplace

Codex Adapter

Claude Adapter

DeepSeek Adapter
```

除非三个 Reference Plugin 的真实运行明确证明缺少某个 Primitive，否则不扩展。

---

# 21. 第一版本的项目成功定义

v0.1 完成后，我们不应该说：

> “已经实现 Agent 时代的 Spring。”

只能说：

> **我们验证了一个 Runtime-neutral Agent Plugin Application Container 的最小内核：它能够把现有三个真实 Plugin 组织成 Application，以 Task 关联多个 Agent Session，通过 Artifact 管理领域 Plugin 间的跨 Session 依赖，通过 Event 支撑横切观察，并保持领域 Plugin 的独立性。**

更重要的结果应该是：

> **以后优化 C2Forge 时，可以主要思考 C2 证明质量；优化 C2Decoder 时，可以主要思考 Decoder 定位、泛化与迁移质量；优化 Postmortem 时，可以主要思考复盘质量。**

而不是继续花大量时间处理：

```text
谁加载谁
谁监听谁
结果放在哪里
路径怎么传
Session 怎么关联
失败怎么记录
```

这些工作才是 Container 应该接走的。

---

# 22. v0.1 最终验收问题

项目完成时只问一个问题：

> **如果把这个 Container 删除，我是不是会明显感觉到维护 C2Forge、C2Decoder、Postmortem 组合任务重新变麻烦了？**

如果答案是：

```text
不会
```

说明 Container 只是增加了一层抽象。

如果答案是：

```text
会。

我又得重新手工管理 Plugin 组合、
Session lineage、
上游 Artifact、
Postmortem 横切关系和任务记录。
```

那么 v0.1 才真正成立。

**Container 的价值不是它管理了多少概念，而是它替业务 Plugin 接走了多少不属于业务本身的复杂度。**
