# OpenMontage Studio 插件 · 设计稿 v0.3

> v0.1 经制、导、枢三视角审查；v0.3 并入均衡自查挑刺（代诤，Z 系列）。诤（grok）与 ikun（minimax）模型连续故障，贾的代审另行归档对照。
> 修订标记：【制N】【导M/S】【枢N】【自ZN】对应各审查意见编号。

---

## 0. 第一性拆解：视频全流程的本质

一个视频项目的生命周期，剥离所有工具表象后剩下四样东西：

1. **不可逆的工序链**：前一道不达标，后一道全是返工。但工序的具体划分随视频形态而变——解说片和 talking-head 的工序不一样【制2】。
2. **认知分工**：创意判断（编）、统筹决策（导）、技术执行（制）。三者是不同性质的脑力劳动，天然适合分给不同 agent 实例。
3. **工件流转**：工序之间传递的不是聊天记录，是工件——剧本稿、分镜表、素材、成片。工件有版本，有验收门。
4. **验收门**：每道工序有明确验收人。验收意见分两级：必修（不过即回退）与建议（记录放行）【导M2】。

**设计结论**：插件不是"把几个聊天框塞进一个界面"，而是一个**流水线工作台**——工序状态机、工件库、工位对话、执行状态，四者合一。Agent 各守工位，工件登记入库，晟只在决策点出现。

---

## 1. 核心设计

### 1.1 实体模型

| 实体 | 字段 | 说明 |
|------|------|------|
| Project | id, title, brief, pipelineId, currentStage, audience, createdAt | pipelineId 指向 OpenMontage `pipeline_defs/*.yaml`；audience 记录目标观众与观看场景【导M4】 |
| StageDef | （来自管线 YAML）id, name, owner, produces[] | **不硬编码**。插件读取所选管线的 stages 列表动态生成泳道【制2、导S1】 |
| Stage | projectId, stageId, status, artifacts[] | status：待料 / 进行中 / 待验 / 已交付 |
| Artifact | id, type, path, version, stageId | type 不枚举，从管线 schema 的 produces 来【制7】。文件实体存**工作区项目目录** `{workspace}/openmontage-projects/{projectId}/`【自Z1：制的 agent 对插件 dataDir 无写权限，工作区才是它的领地】 |
| Review | stageId, mustFix[], suggestions[], verdict, reviewer | 验收工件。mustFix 不过→回退；suggestions 入库不阻断【导M2】 |
| Thread | stageOwnerKey, agentId, sessionId | 每个工位一个 plugin_private 会话 |

### 1.2 状态机

- **owner 与验收人分离**：每个 stage 有执行 owner 和验收人。例：script 执行=编、验收=导；deliver 执行=制、验收=导/晟【导M3】。
- **brief 段 owner=导**：creative intake、定 pipeline 及理由，是项目地基【导M1】。
- **推进权**：仅验收人（导或晟）。工位 agent 只能申报"待验"。
- **回退**：验收人指定回退目标 stage（可跨级，如审片发现素材不够直接回 assets）【制6】，工件 version+1。
- **升级机制**：同一阶段连续回退 2 次，自动标记"待晟裁决"，防止编导之间踢皮球【导S3】。
- **诤的介入**：导可在任意 checkpoint 召唤诤审查，审查报告作为该 stage 的 Review 工件【导S2】。召唤走 Hana 原生 subagent 机制（导在自己会话里发起），插件不参与【自Z6】。

### 1.3 界面（一个 page，四区）

```
┌────────────────────────────────────────────────┐
│ 项目选择器   流水线状态条（段数随管线 YAML 动态）   │
├──────────────────────┬─────────────────────────┤
│ 工位区                │ 工件库                   │
│ [编] [导] [制] tab    │ 当前项目工件列表          │
│ 当前工位对话面板        │ 预览 / 版本 / 登记        │
├──────────────────────┴─────────────────────────┤
│ 执行面板：制的任务状态 / 进度 / 日志摘要            │
└────────────────────────────────────────────────┘
```

### 1.4 技术路径

- **插件形态**：full-access，`contributes.page`，routes 承载 iframe UI，direct 模板（无构建步骤，枢确认，skill-market 已验证该模式）。
- **多助手同屏**：`createSession({ agentId: "bianju" | "daoyan" | "zhizuo", visibility: "plugin_private", ownerPluginId, cwd })`。SDK 已确认 agentId 为自由参数（PLUGIN_SDK.md，2026-08-01 验证）；制的工位会话 cwd 指向项目工作目录。`subscribeSessionEvents` 渲染消息流。
- **上下文注入**：`sendSessionMessage(..., { context })` 只注入**路径级摘要**，不注内容【制5】：
  1. 当前 stage 与上游工件的路径清单
  2. 前序 checkpoint 的验收意见（含被延后的建议项）【导M4】
  3. pipeline 选择及其理由
  4. 目标观众与观看场景
  agent 需要细节时自行 read 工件文件。
- **执行状态回流**【制1，已校正】：SDK 存在 registerTask/updateTask 系任务 API（制的初判依据为 hyperframes 旧代码，已过时）。但 agent 会话内 exec 的进度插件无法自动感知，采用制的方案：插件注册静态工具 `openmontage-studio_reportTask`（参数：taskId, stage, status, progress, logSummary, artifactPaths），制在工序节点主动调用；插件内部映射到 registerTask/updateTask 呈现于执行面板。最短回路，职责清晰。
- **工件存储**：文件实体在工作区项目目录（制的 agent 可写，跨会话持久）【制4、自Z1】；插件 `ctx.dataDir` 只存元数据 JSON。插件读取工件走 `ctx.resources` + manifest 声明 `resource.read`【自Z2】。SessionFile 仅用于给晟的临时预览交付。
- **工件预览**：文本/图片类工件 iframe 内直接渲染；视频工件一期用 `external.open` 交系统播放器（ui.hostCapabilities 声明），二期再做 route 流式代理（byte range 自实现）【自Z1：assets/ 托管只服务插件自带资产，管不了工作区文件】。
- **资源与配置**：OpenMontage repo 路径进 `contributes.configuration`（可配），插件读 `pipeline_defs/*.yaml` 走 `ctx.resources`，不裸 fs【自Z2】。
- **reportTask 权限**：工具声明 `sessionPermission: { kind: "plugin_output" }`（仅写 dataDir 内 TaskStore）。漏声明或错标会导致 Auto 模式每次送审、执行面板卡死【自Z3】。
- **状态权威**：插件数据（项目 JSON + TaskStore）是唯一事实源。agent 口头申报"做完了"不算数，验收人只看插件内状态【自Z4】。上下文注入时把插件记录的当前状态带给 agent，供其自纠。

### 1.5 MVP 边界

**做**：单页四区、pipeline 驱动的状态机、三工位对话、工件登记与预览、reportTask 执行面板、Review 两级验收。
**不做**：agent 全自动接力编排、多项目复杂管理 UI、素材抓取（bilibili-intake 另一条线）、云端渲染、诤/枢独立工位（二期）。

### 1.6 小参数模型实施约束

- direct 模板，vanilla JS + 服务端注入数据。
- 单文件 < 300 行，一文件一职责，一任务一句话验收标准【枢2】。
- 实施序列见第 3 节。

---

## 2. 风险登记册

| # | 风险 | 级别 | 状态 |
|---|------|------|------|
| R1 | createSession 绑已有 agent | ~~致命~~ → 低 | SDK 文档验证通过，T2 冒烟兜底 |
| R2 | full-access 总开关、dev tools 开关 | 阻断前置 | 用户侧确认 |
| R3 | iframe 多会话事件订阅性能 | 实质 | 骨架后压测 |
| R4 | 执行结果回流 | ~~实质~~ → 低 | reportTask 方案已定，T9 验证 |
| R5 | 视频 iframe 预览 | 低 | byte ranges 已验证 |
| R6 | plugin_private 会话与主会话上下文割裂 | 实质 | 由上下文注入机制缓解；一期接受 |
| R7 | createChatSurfaceCard 可作工位对话降级/增强形态 | 信息 | 记录在案 |
| R8 | dev 槽位与生产槽位 dataDir 分离，dev→生产迁移时项目元数据丢失 | 实质 | 一期接受并记录；正式使用前迁到生产槽位再建项目【自Z5】 |
| R9 | 插件卸载后 plugin_private 会话成为无主会话 | 一般 | 一期接受；卸载前导出工件（工件在工作区，天然不受插件存亡影响）【自Z1 附带收益】 |

## 3. 实施任务序列（枢版，已采纳）

| # | 任务 | 验收标准 |
|---|------|----------|
| T1 | 骨架：manifest + route + 空白页（提示词内嵌红线清单精简版：manifest 字段齐全 / route 与 manifest 一致 / capabilities 显式列举非空 / iframe 用 hana.api.fetch / ticket 不拼资产 URL / activationEvents 用 onStartup）【自Z7】 | 插件加载、页面可打开 |
| T2 | R1 冒烟：createSession 绑 bianju 收发一条消息 | 消息双向到达；失败→自动重试一次排除偶发→仍失败停工上报晟裁决（不擅自切备选 A，晟 2026-08-01 授权此默认） |
| T3 | 数据模型 + JSON 存储 | Project/Stage/Artifact 增删改查，重启后数据在 |
| T4 | 状态机推进/回退逻辑 | 非法跳转被拒，回退 version+1，升级机制触发正确 |
| T5 | 状态条 + 项目选择器 UI | 泳道段数随管线 YAML 正确渲染 |
| T6 | 单工位对话面板 | 编工位消息流渲染、可发送 |
| T7 | 三工位 tab + 上下文注入 | 切换不串会话，注入内容 agent 可见 |
| T8 | 工件库：登记/列表/预览/下载 | 工件入库可查，视频可预览 |
| T9 | reportTask 工具 + 执行面板 | 制侧调用后任务状态实时出现在面板 |
| T10 | 端到端联调 | 一个测试项目走完全部工序 |

## 4. 审查记录

| 审查员 | 关键吸收 |
|--------|----------|
| 制 | 状态机 pipeline 动态化（原致命2）、edit 阶段、reportTask 回流方案（原致命1 校正后采纳）、工件存储路径、上下文注入收敛、跨级回退、Artifact.type 不枚举 |
| 导 | brief owner=导、验收两级结构化、deliver 验收人分离、注入三要素、诤任意 checkpoint 可召唤、连续回退升级晟 |
| 枢 | R1 冒烟提为 T2 go/no-go 门、任务粒度再拆、R4 验证前置、direct 模板确认 |
| 均衡自查（代诤） | 工件存储改工作区（Z1）、资源访问走 ctx.resources + resource.read（Z2）、reportTask 必须标 plugin_output（Z3）、状态权威单一源（Z4）、dev/生产 dataDir 分离（Z5）、诤召唤走原生 subagent 不经插件（Z6）、实施提示词内嵌红线清单（Z7） |
| 诤 / ikun | 模型连续故障，未产出；贾代审归档对照 |
