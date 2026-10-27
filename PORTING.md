# dsh-tutor 移植方案

本文件定义 dsh-tutor 相对上游 `BaronCyrus/dsh-aha-tutor` 的边界：保留什么、补什么、明确不做什么。
上游保持为 `upstream` remote，用于取安全修复；本仓库的提交不保证能反向合入上游。

## 身份与命名（待定）

| 项 | 现状（继承自上游） | 候选 |
| --- | --- | --- |
| GitHub 仓库 | `tcztzy/dsh-tutor`（fork） | 已定 |
| npm 包名 | `dsh-aha-tutor` | `dsh-tutor` |
| 插件行 id | `aha-tutor`、`preset-aha-tutor` | `tutor`、`preset-tutor` |
| RPC 通道 | `/aha-tutor` | `/dsh-tutor` |
| 数据目录 | `$DSH_HOME/aha-tutor/` | `$DSH_HOME/dsh-tutor/`（需一次性迁移） |

改名影响所有 `lib/`、i18n、测试与文档；在新项目没有既有用户的前提下，越早改成本越低。数据目录迁移必须在 Host 首次启动时做一次原子搬迁，不能静默丢数据。

## 原则

1. **课堂不动，内核补齐。** 黑板、语音、蓝图、练习、计划这些体验是上游的强项，本次改造不重写。
2. **机制自研，文案不抄。** 上游 `AGENTS.md` 要求原创文案、不得描述为其他产品的克隆；DeepTutor 为 Apache-2.0，可参考算法与数据形状，但不搬运其 prompt 文本与 UI 措辞。
3. **门禁是代码。** 掌握与否由 `src/core/` 的纯函数判定，模型只能提交证据，无权宣布过门。
4. **不为架构而架构。** 不引入服务端、数据库或独立运行时；DSH 仍是宿主。

## 现状盘点：上游已经有的，不要重造

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 掌握度估计 | `src/core/mastery.js` | BKT，`pKnown` 按 slip/guess 更新，信心/提示/犹豫会调整参数；五级展示阈值 0.9 |
| 证据记录 | `src/core/evidence-log.js` | 作答、自评、重讲等证据流 |
| 间隔重复 | `src/core/srs.js` | 复习排程 |
| 学习计划 | `src/core/planner.js` | 排课与顺延 |
| 本地检索 | `src/core/retrieval.js` | 资料全文检索（无向量库） |
| 课程模型 | `src/core/course-model.js` | units → chapters → lessons；知识点以 `conceptIds` 扁平引用，无类型与前置 |
| 评分 | `src/core/grading.js` | 客观题即时判定、简答按要点 |

结论：DeepTutor 的「BKT 式自适应」上游其实已经做得更细；我们缺的是**门禁语义**与**知识点的结构化**。

## DeepTutor → dsh-tutor 映射

| DeepTutor 能力 | 上游现状 | 本仓库动作 |
| --- | --- | --- |
| 目标级硬门禁（按类型阈值、单次正确封顶、定性评估） | 有 BKT 估计与五级展示，但**不阻断推进** | **M1** 新增 `gate.js`：类型阈值 + 最小证据数 + 信心封顶 + concept/design 定性通过；门禁结论进入课程推进判定 |
| objective 图（类型、前置、掌握状态） | `conceptIds` 扁平，无类型/前置 | **M2** `course-model` 增加 `concepts[]`（type、prerequisites），大纲校验前置合法；UI 展示门禁状态 |
| Book Engine（proposal → spine → block 编排 → 逐段写作） | 蓝图 → 板书脚本 → 讲义 | 只取两条：结构先于文字、每讲必须挂 objective；**不移植** block 体系与字数预算状态机 |
| 多引擎 RAG（LlamaIndex/GraphRAG/LightRAG…） | 本地材料 + 页码引用 + 全文检索 | **不换**检索后端；**M3** 补「生成物必须带来源引用」的校验 |
| 研究 / 解题 / 可视化 | 无 | **M4** 作为课程内工具接入，不做独立大模块 |
| 多用户、监护人、IM Partners、CLI NDJSON | 无 | **不做**（DSH 已提供会话与权限） |

## 里程碑与验收

| 里程碑 | 交付 | 验收 |
| --- | --- | --- |
| M0 | 本文件；确认接入点 | 评审通过 |
| M1 | `src/core/gate.js`：类型阈值、近期加权、信心封顶、定性评估 | ✅ 完成（`gate.test.mjs`，13 例） |
| M2 | concept 类型 + 前置 + 门禁状态；完成一讲须过门；定性讲解评估 | ✅ 完成（`objective-graph.test.mjs`、`host-wiring` 端到端） |
| M3 | 速查表与讲义的引用校验：材料与页码必须存在 | ✅ 完成（`citation.test.mjs`；伪造引用被丢弃、内容保留） |
| M4 | 课程内「查一查」：联网研究与分步解题 | ✅ 完成（`lesson/explore`；不产生学习证据） |
| M4* | 动画与视频 | 委托：交给已安装的动画插件（Manim / Remotion），课程只做静态图；不跨插件调用 |
| M5 | 文档、i18n（zh/en 同键）、打包 | ✅ 文档与 README 更新；`pnpm run check` 通过；scratch profile 手测未做 |

### 实现中定下的边界

- **旧课程**：知识点缺 `type` 时按 `memory` 判定，保证存量课程不会因为新门禁永久锁死。
- **定性类型**：只有 `concept` / `design` 需要讲解评估；生成器被要求「大多数是 memory/procedure」，避免把整门课变成口头考试。
- **引用**：校验失败只丢引用，不丢内容；速查表与讲义都会返回 `dropped` 报告。
- **探索**：`lesson/explore` 的联网结果带编号来源；没有搜索服务时明确说 `skipped: 'unavailable'`，不假装查过。
- **可视化**：不调用其他插件的工具（它们只注册工具、不暴露宿主服务）；动画由会话中安装的动画插件完成，课程界面只做静态图。

通用验收：`pnpm run check`（全部测试 + 重新构建 `lib/` + 打包）必须通过；UI 改动需在独立 `DSH_HOME` 的 scratch profile 中手测；未经明确授权不 `npm publish`、不打 tag、不发 Release。

## 明确不做

- 不重写黑板渲染、语音、视频导出。
- 不引入向量数据库或外部 RAG 服务。
- 不做多用户、IM 渠道、CLI 自动化。
- 不复制 DeepTutor 的 prompt 原文与界面文案。
