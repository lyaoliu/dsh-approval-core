# dsh-approval-core

自动审批决策管道:例行放行、危险转人工(fail-safe),学习受约束。

设计文档见 [docs/specs/2026-09-06-dsh-approval-core-design.md](docs/specs/2026-09-06-dsh-approval-core-design.md)。

## 安装

```powershell
dsh plugin --profile web add ./dsh-approval-core
```

## 配置（v1 无规则修改 API）

v1 出于安全考虑不提供任何 HTTP 规则修改入口（无 POST /api/auto-approve/rules、无 POST /api/auto-approve/setup）。规则、阈值与学习开关一律直接编辑配置文件：

- `$DSH_HOME/auto-approve/allowlist.json`：denyKeywords / allowRules / denyRules / hardCategories / riskyThreshold / judgeTimeoutMs / learning。保存后自动生效（每次审批前热读盘，无需重启）；其中 denyKeywords 的正则危险清单在插件加载时编译，变更需重启 dsh web。
- 权限预设：直接在 profile 的 cordis.patch.yml 中添加 auto-approve 权限预设（预设表在配置构造时冻结，无法自动扩展）。

HTTP 接口仅保留只读查询（GET events / GET diff / GET snapshots-stats）与两种非规则操作（POST revert 撤销指令投递、POST snapshots-clear 快照清理）。

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

数据文件（`$DSH_HOME/auto-approve/`）：

- `allowlist.json` — 规则与配置（人工编辑，热读生效）
- `learning.json` — 学习状态（独立于主白名单，可一键清空）
- `audit.log` — 每次判定的决策审计（DENY/ALLOW/RISKY/OUTCOME/LEARN）
- `events.jsonl` — 审查 UI 轮询用的事件流（自动放行提示条 + 审批历史视图）

## 与上游 dsh-approval-gate 的差异

- **修复**：`permissionPresets.current(session.events)` → `current(session)`。上游在 0.1.2-rc.1 上传入的 `session.events` 属性不存在（undefined），导致预设判定必崩、插件从不接管（fail-safe 只表现为"原生弹窗"）。本 fork 传入完整 Session 实例，真机验证管道正常接管。
- **加固**：关键词 DENY 层替换为 13 条确定性正则危险清单（移植自 dsh-auto-approve）+ denyKeywords 字面量第二层；分类输出严格双协议解析（精确 JSON `{"verdict":"approve"|"ask"}` 或 `SAFE`/`RISKY:<category>`），垃圾输出一律转人工；`NOT SAFE`/`UNSAFE`/不确定措辞不再被误判为 safe。
- **学习约束**（方案 B）：阈值默认 5；沉淀必须指纹强命中；学习态独立存储（learning.json）可一键清空；`learning.enabled=false` 时全部转人工。
- **安全**：移除 HTTP 规则修改接口（rules POST / setup POST），配置只走文件。
- **测试**：25 个 node:test 用例 + 20 断言 mock 宿主冒烟（`node --test`；本机用 `node test/*.test.mjs` 进程内执行）。
