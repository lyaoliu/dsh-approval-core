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
