# dsh-approval-core

自动审批决策管道:例行放行、危险转人工(fail-safe),学习受约束。

设计文档见 [docs/specs/2026-09-06-dsh-approval-core-design.md](docs/specs/2026-09-06-dsh-approval-core-design.md)。

## 安装

```powershell
dsh plugin --profile web add ./dsh-approval-core
```

## 配置（v0.2.0 恢复受限规则 API）

规则、阈值与学习开关既可以编辑配置文件，也可以通过受限的 HTTP 接口修改：

- `$DSH_HOME/auto-approve/allowlist.json`：denyKeywords / allowRules / denyRules / hardCategories / riskyThreshold / judgeTimeoutMs / learning / dataDir / classifierModel。保存后自动生效（每次审批前热读盘，无需重启）；其中 denyKeywords 的正则危险清单在插件加载时编译，变更需重启 dsh web。
- 权限预设：直接在 profile 的 cordis.patch.yml 中添加 auto-approve 权限预设（预设表在配置构造时冻结，无法自动扩展）。

HTTP 接口：

- `GET /api/auto-approve/rules` — 只读展示（配置 + 学习状态 + 预置清单 + 各 kind 的 permission 级别，供 UI 渲染）。
- `POST /api/auto-approve/rules` — 受限写接口，服务端两级校验：`classifyOp`（四级权限矩阵：free/confirm/forbidden）→ `validateValue`（结构与范围）。forbidden 返回 403，校验失败返回 400。`hardCategories` 永远 forbidden；删除预置项 forbidden；`danger-full-access` 不可加入白名单。
- 其余只读查询（GET events / GET diff / GET snapshots-stats）与两种非规则操作（POST revert、POST snapshots-clear）。

**dataDir**（可选，绝对路径）：把 learning.json / audit.log / events.jsonl / snapshots 迁到自定义目录（如 `D:\data\dsh-approval`）。仅接受绝对路径，相对路径视为配置错误回退默认（fail-safe）。迁移方式：手动把旧文件拷到新目录；`allowlist.json` 本身始终留在默认目录（它声明了 dataDir）。

### 配置 UI 权限分级

设置页按四级权限渲染每个配置项；安全边界在服务端 `classifyOp` + `validateValue`，UI 确认框只是体验层：

| 级别 | 配置项 | 交互 |
| --- | --- | --- |
| 🟢 只读 | 管道总览、学习进度、数据目录、分类模型 | 仅展示，无写控件 |
| 🟡 自由改 | `riskyThreshold`（1-20）、`judgeTimeoutMs`（5s-120s） | 直接改，服务端范围校验（400） |
| 🟠 确认改 | 加黑名单词 / 加白名单规则 / 删除自定义项 | 弹确认框后提交 |
| 🔴 UI 禁改 + 服务端 403 | 硬风险类别、删除预置项、`danger-full-access` 加白 | UI 无控件；绕过 UI 直发请求也被服务端拒绝 |

### 分类模型

`allowlist.json` 加 `"classifierModel": {"provider": "...", "model": "..."}` 指定 flash 分类器模型，优先于会话默认模型（优先级：显式配置 > 会话默认模型 > 内置回退）。改文件即生效，`POST /rules` 不开放修改（避免 UI 误配烧 token）；配置不合法时自然回落会话默认模型。

## 行为（真机验证 2026-09-07, DSH Desktop 2.0.5 / 0.1.2-rc.1）

| 场景 | 行为 |
| --- | --- |
| 工作区内写文件 | 沙箱直接放行（不经过审批瀑布），零打扰 |
| 越界请求（neutral 类） | 前 `riskyThreshold`（默认 5）次转人工确认，并按操作指纹记入学习样本 |
| 同指纹同类操作达阈值后 | 自动放行（`fp-hit`），审计标记 `auto-learned` |
| 硬风险类别（deletion/credential/remote/system/bulk） | 永远人工，不计数、不学习 |
| 正则危险清单命中（rm -rf / force-push / curl\|sh 等 13 条 + denyKeywords） | 永远人工，先于分类器执行 |
| 分类器超时/失败/输出无法解析 | fail-safe 转人工 |
| 人工拒绝 | 升级为永久人工规则（denyRules），清除该类学习计数 |
| `/approval-core-clear-learning` | 一键清空全部学习沉淀（stats 与 history） |

数据文件（`$DSH_HOME/auto-approve/`，可通过 `dataDir` 迁移）：

- `allowlist.json` — 规则与配置（人工编辑，热读生效）
- `learning.json` — 学习状态（独立于主白名单，可一键清空）
- `audit.log` — 每次判定的决策审计（DENY/ALLOW/RISKY/OUTCOME/LEARN）
- `events.jsonl` — 审查 UI 轮询用的事件流（自动放行提示条 + 审批历史视图）

## 与上游 dsh-approval-gate 的差异

- **修复**：`permissionPresets.current(session.events)` → `current(session)`。上游在 0.1.2-rc.1 上传入的 `session.events` 属性不存在（undefined），导致预设判定必崩、插件从不接管（fail-safe 只表现为"原生弹窗"）。本 fork 传入完整 Session 实例，真机验证管道正常接管。
- **加固**：关键词 DENY 层替换为 13 条确定性正则危险清单（移植自 dsh-auto-approve）+ denyKeywords 字面量第二层；分类输出严格双协议解析（精确 JSON `{"verdict":"approve"|"ask"}` 或 `SAFE`/`RISKY:<category>`），垃圾输出一律转人工；`NOT SAFE`/`UNSAFE`/不确定措辞不再被误判为 safe。
- **学习约束**（方案 B）：阈值默认 5；沉淀必须指纹强命中；学习态独立存储（learning.json）可一键清空；`learning.enabled=false` 时全部转人工。
- **安全**：v0.2.0 恢复受限版 `POST /api/auto-approve/rules`——写操作必须通过 configRules.mjs 的 classifyOp（四级权限矩阵）+ validateValue 双重服务端校验；硬类别与 classifierModel 不可经 UI 修改。上游的对应 API 无鉴权全开放。
- **移植上游 0.5.2**：① callId 回溯 tool/call 参数拿结构化文件路径（B 层，diff 审查定位更准）；② 只读命令假快照过滤 + manual-pending 也存快照 + Windows 盘符路径修复（最后一项超出上游的修复）。
- **测试**：37 个 node:test 用例（danger-patterns 7 / classifier 4 / learning 7 / pipeline 7 / config-rules 12）+ 33 断言 mock 宿主冒烟（含 dataDir 可配场景；本机用 `node test/*.test.mjs` 进程内执行）。
