# dsh-approval-core 设计文档

> 日期:2026-09-06 · 状态:草案 · 范围:两阶段(先自用,成熟后发布)

## 1. 定位

DeepSeek Harness 自动审批**决策管道**插件:例行沙箱越界自动放行,危险/拿不准/失败才转人工。

核心原则(由用户拍板):
- **少打扰**:不含任何"主动审批层"(不做逐操作事前 diff 审批、不做逐轮审查卡片)。日常零弹窗。
- **被动问责**:事后审查做成**自动记录、按需查看**——操作前自动快照,用户需要时随时查 diff、随时回滚,不查则完全隐形。
- **安全纵深**:确定性危险清单先于 LLM,学习被约束且可见。

## 2. 判定管道(七层,自研核心)

```
① 正则危险清单(确定性,先于一切,LLM 无法推翻)
   移植 dsh-auto-approve 的 13 条:rm -rf 破坏性目标 / dd 设备写入 / mkfs /
   force-push / curl|sh / 破坏性 SQL / shutdown / chmod -R 777 /  fork 炸弹 /
   terraform|pulumi destroy / 混淆写法($() 反引号 <() + rm|dd|mkfs|chmod|chown)
   + extraDangerPatterns 可扩展(无效正则加载时报错)
   → 命中:人工,记录审计
② 白名单规则(tool + mode + category + contains 四元匹配)
   - 默认空;可配置"workspace-write 免分类"档(省 token,可回补)
   → 命中:放行
③ 拒绝学习(用户人工拒绝过 → 升级永久 denyRules)
   → 命中:人工(拒绝优先于沉淀)
④ 分类器(toolName + mode + justification → SAFE / RISKY:<category>)
   - 模型可配(provider + model),默认跟随会话默认模型
   - 严格输出解析:只认精确 JSON `{"verdict":"approve"|"ask"}`(auto-approve 协议)
     或 SAFE/RISKY:<category>(approval-gate 协议)——双协议兼容
   - 无模型 / 模型失败 / 超时×2 / 解析失败 → 人工(fail-safe,绝不自动放行)
⑤ 硬风险类别 deletion / credential / remote / system / bulk → 永远人工,
   不计数、不学习
⑥ neutral 学习(方案 B,约束版)
   - 同一 key(tool|mode|category)人工确认满阈值(默认 5,可配)后:
     指纹强命中 → 自动放行并沉淀规则
     指纹未命中但有样本 → 分类器语义同类验证(SAME 放行 / DIFFERENT 人工)
     无样本 → 人工
   - 约束:无指纹不沉淀;学习规则**独立存储、可一键清空/回滚**,
     不写进主白名单;learning.enabled 总开关;审计标记 auto-learned/removed
⑦ 任何异常 / 中断 / 未知类别 → 人工(fail-safe)
```

## 3. 审计

- 复用 dsh 原生 `approval/asked` + `approval/decided` 会话事件(成对,同 id)
- 每裁决一行结构化日志:`decision=auto-approve|manual pattern=...`
- `/report` 命令展示本会话三组明细:自动批准 / 危险清单拦截 / 分类器转人工
- 完整历史走 Session log 导出

## 4. 被动问责层(不自研,现成组合)

- v1:复用已安装的 dsh-approval-gate 自带审查视图(审批快照 + diff + 撤销)
  ——或直接采用其快照机制,操作前自动存快照、按需查看
- 可选升级:install dsh-checkpoint-rewind + dsh-checkpoint-diff
  (任意节点 diff、跨会话、预览回滚、绝不删除)——升级项,非 v1 范围
- 快照目录可配,默认放 D 盘(用户偏好,不占 C 盘)

## 5. 工程约束

- 零运行时依赖(peer 依赖 schemastery 由 harness 供给)
- 无 build/install 脚本;node --test 覆盖各层(危险清单/解析/学习/回滚)
- v1 不做本地 HTTP 规则写接口(改配置文件生效,重启或热更新)——从根上消掉
  无鉴权 API 风险
- 数据文件:$DSH_HOME/auto-approve/ 下 allowlist.json / learning.json /
  audit.log(追加式)
- 发布:第一阶段本地 profile 使用;成熟后 GitHub + npm + CI

## 6. 基线候选(实施时二选一)

- A(推荐):fork dsh-approval-gate,保留其学习+审查视图,替换危险清单为正则版、
  补测试、摘除规则写接口、学习加约束——"补洞"路线
- B:fork dsh-auto-approve,加 B 学习 + 被动快照——"加功能"路线
- C:从零写——架构最干净,成本最高(不推荐)

## 7. 明确不做(YAGNI)

- ❌ 事前逐操作 diff 审批(dsh-edit-approval 式)——与少打扰矛盾
- ❌ 逐轮审查卡片(dsh-change-review 式)——与审计层功能重叠
- ❌ v1 不做 HTTP 规则管理 API
- ❌ 不做跨会话项目级时间线(v2 考虑 checkpoint 系)

## 8. 兼容性(待实测)

- 目标:DSH Desktop 2.0.5 / 客户端 0.1.2-rc.1
- approval-gate npm 0.5.0 已装且预设已配置;基线 A 需确认其 0.1.2-rc.1 下
  审批事件/预设机制行为一致
- 分类模型:默认跟随会话默认模型(commandcode deepseek-v4-flash-vision-exp),
  需确认 reasoningEfforts=off 可用;预算敏感,勿默认大推理模型
