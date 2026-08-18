# OpenMontage Studio · 设计稿

> 设计过程经过多视角对抗性审查（生成 / 审查 / 调度三类视角），本稿为公开版，保留最终设计结论。

---

## 0. 第一性拆解：视频全流程的本质

一个视频项目的生命周期，剥离所有工具表象后剩下四样东西：

1. **不可逆的工序链**：前一道不达标，后一道全是返工。工序的具体划分随视频形态而变。
2. **认知分工**：创意判断（编）、统筹决策（导）、技术执行（制）。三者是不同性质的脑力劳动，天然适合分给不同 agent 实例。
3. **工件流转**：工序之间传递的不是聊天记录，是工件——剧本稿、分镜表、素材、成片。工件有版本，有验收门。
4. **验收门**：每道工序有明确验收人。验收意见分两级：必修（不过即回退）与建议（记录放行）。

**设计结论**：插件是一个**流水线工作台**——工序状态机、工件库、工位对话、执行状态，四者合一。Agent 各守工位，工件登记入库，用户只在决策点出现。

---

## 1. 核心设计

### 1.1 实体模型

| 实体 | 字段 | 说明 |
|------|------|------|
| Project | id, title, brief, pipelineId, currentStage, audience, createdAt, workDir | pipelineId 指向管线定义；workDir 为可选本地工作台目录 |
| StageDef | （来自管线 YAML）id, name, owner, produces[] | **不硬编码**，读取所选管线的 stages 动态生成 |
| Stage | projectId, stageId, status, artifacts[] | status：待料 / 进行中 / 待验 / 已交付 |
| Artifact | id, type, path, version, stageId | type 不枚举；文件实体存工作台项目目录，工作台新文件自动登记 |
| Review | stageId, mustFix[], suggestions[], verdict, reviewer | 验收工件。mustFix 不过→回退；suggestions 入库不阻断 |
| Thread | stageOwnerKey, agentId, sessionId | 每个工位一个 plugin_private 会话 |

### 1.2 状态机

- **owner 与验收人分离**：每个 stage 有执行 owner 和验收人。例：script 执行=编、验收=导；deliver 执行=制、验收=导/用户。
- **brief 段 owner=导**：creative intake、定 pipeline 及理由，是项目地基。
- **推进权**：仅验收人（导或用户）。工位 agent 只能申报"待验"。
- **回退**：验收人指定回退目标 stage（可跨级），工件 version+1。
- **升级机制**：同一阶段连续回退 2 次，自动标记"待用户裁决"，防止编导之间踢皮球。
- **审查介入**：导可在任意 checkpoint 召唤审查 agent，审查报告作为该 stage 的 Review 工件（走 Hana 原生 subagent 机制，插件不参与）。

### 1.3 界面（一个 page + 一个 widget，四区）

```
┌────────────────────────────────────────────────┐
│ 项目选择器（卡片弹层）   流水线状态条（随管线动态）  │
├──────────────────────┬─────────────────────────┤
│ 工位区                │ 工件库（独立滚动）         │
│ [编] [导] [制] tab    │ 自动登记 / 分组 / 预览     │
│ 当前工位对话面板        │ 投递到桌面端工作台         │
├──────────────────────┴─────────────────────────┤
│ 执行面板：制的任务状态 / 进度 / 日志摘要            │
└────────────────────────────────────────────────┘
```

侧边栏 widget 聚合各项目工件，点击通过宿主能力打开本地预览。

### 1.4 技术路径

- **插件形态**：full-access，`contributes.page` + `contributes.widget`，routes 承载服务端渲染 UI，direct 模板（无构建步骤）。
- **多助手同屏**：`session:create`（agentId 自由参数，visibility plugin_private，ownerPluginId 归属插件）。
- **工位 Agent 一键准备**：`agent:create` 创建插件私有 agent（visibility plugin_private），已存在则复用；新环境点「准备工位」即完成。
- **上下文注入**：`session:send` 的 context 只注入路径级摘要（当前 stage、上游工件路径、前序验收意见、pipeline 与理由），agent 需要细节时自行读工件文件。
- **执行状态回流**：静态工具 `task_report`（taskId, stage, status, progress, logSummary, artifactPaths），制在工序节点主动调用。
- **工件存储**：文件实体在工作台项目目录（workDir 或插件 dataDir 下 projects/{id}）；插件 dataDir 只存元数据 JSON。
- **自动登记**：工件列表轮询时对工作台目录做节流扫描，新文件自动登记为工件（忽略隐藏文件/临时文件）。
- **会话自愈**：会话引用的 agent 不可用时自动重建（清除失效线程 → 重建 → 重试一次）。
- **文件与工作台**：页面支持文件/文件夹导入（相对结构存放）；工作台路径可通过系统文件夹选择器（宿主 resource.pick 能力）选择。
- **投递到桌面端工作台**：工件可一键复制到用户配置的投递目录（`deskDeliverDir`），桌面端直接预览。
- **安全**：工件读取拒绝目录穿越与项目外绝对路径；页面 UI 能力走 manifest `ui.hostCapabilities` 白名单（resource.pick / resource.open）。

### 1.5 MVP 边界

**做**：单页四区、pipeline 驱动的状态机、三工位对话、工件登记与预览、reportTask 执行面板、Review 两级验收、投递工作台、侧边栏 widget。
**不做**：agent 全自动接力编排、多项目复杂管理 UI、素材抓取（独立线）、云端渲染、更多独立工位（二期）。

---

## 2. 风险登记册

| # | 风险 | 级别 | 缓解 |
|---|------|------|------|
| R1 | createSession 绑定已有 agent | 低 | SDK 验证通过，会话自愈兜底 |
| R2 | full-access 总开关 | 前置 | 用户侧确认 |
| R3 | iframe 多会话事件订阅性能 | 实质 | 轮询 + 节流 |
| R4 | 执行结果回流 | 低 | task_report 方案 |
| R5 | 视频 iframe 预览 | 低 | 宿主打开 / video 标签 |
| R6 | plugin_private 会话与主会话上下文割裂 | 实质 | 上下文注入缓解，一期接受 |
| R7 | dev 槽位与生产槽位 dataDir 分离 | 实质 | 正式使用前迁生产槽位 |
| R8 | 插件卸载后 plugin_private 会话无主 | 一般 | 一期接受；工件在工作区不受插件存亡影响 |
| R9 | agent 懒加载导致的存在性误判 | 低 | 磁盘级 agent:list 查询 + 会话自愈 |

---

## 3. 实施序列（已完成）

| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | 骨架：manifest + route + 页面 | ✅ |
| T2 | 会话冒烟：createSession 绑定工位收发消息 | ✅ |
| T3 | 数据模型 + JSON 存储 | ✅ |
| T4 | 状态机推进/回退/升级 | ✅ |
| T5 | 状态条 + 项目选择器 | ✅（升级为卡片弹层） |
| T6 | 工位对话面板 | ✅ |
| T7 | 三工位 tab + 上下文注入 | ✅ |
| T8 | 工件库：登记/列表/预览 | ✅（含自动登记） |
| T9 | task_report + 执行面板 | ✅ |
| T10 | 端到端联调 | ✅ |
| T11 | 一键准备工位 Agent（agent:create） | ✅ |
| T12 | 文件/文件夹导入 + 本地工作台 | ✅ |
| T13 | 投递桌面端工作台 + 侧边栏 widget | ✅ |
