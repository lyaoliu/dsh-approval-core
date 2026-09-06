# Task 1 报告:Fork 仓库脚手架(dsh-approval-core)

**状态:DONE**
**日期:2026-09-06**
**Commit:** 见下方"git 提交"一节

## 做了什么

1. **复制上游源码(Step 1)** — 按 brief 命令逐字执行:
   - `C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\src\index.mjs` → `src\index.mjs`
   - `C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\client.js` → `client.js`
   - SHA256 校验两者与上游逐字节一致:
     - `src/index.mjs`: `9424B6C5596137CFAC91261272F5496BC33507E5481283EF8CE8A433BEEED4CD`
     - `client.js`: `D8555B954B97F091FD56AEC8F7DBF86219E621D7265D6685EDFE27B60118F34D`
   - 确认上游 `package.json` version = **0.5.0**

2. **package.json(Step 2)** — 按 brief 逐字创建(name/description/version/exports/files/scripts/dsh/peerDependencies/devDependencies 全部照抄 brief,仅改名 dsh-approval-core,零 dependencies)。

3. **cordis.patch.yml(Step 3)** — 照抄 brief 内容,仅 plugin id/name 为 `dsh-approval-core`。

4. **LICENSE(Step 4)** — MIT,正文照抄上游 LICENSE(保留 `Copyright (c) 2026 moon09300731`),文件末尾追加一行 `Forked from dsh-approval-gate (moon09300731)`(按用户补充指示放末尾,brief 原文为"首行注释",以用户指示为准)。

5. **README.md(Step 5)** — 按用户补充指示的骨架:项目名、一句话定位(自动审批决策管道:例行放行/危险转人工/学习受约束)、指向 `docs/specs/2026-09-06-dsh-approval-core-design.md` 的链接、安装命令 `dsh plugin --profile web add ./dsh-approval-core`(本地路径)。

6. **验证(Step 6)** — 见下方。

7. **git init + 提交(Step 7)** — 按 brief 命令执行。

## 验证命令与输出

```
PS> node --check src/index.mjs
index.mjs exit: 0            (无输出,通过)

PS> node --check client.js
client.js exit: 0            (无输出,通过)

PS> node -e "const p=require('./package.json'); ..."
name=dsh-approval-core version=0.1.0 type=module main=./src/index.mjs
pkg parse exit: 0            (JSON 合法)

PS> node -e "console.log(require('...dsh-approval-gate/package.json').version)"
upstream version: 0.5.0      (与 brief "fork 0.5.0" 一致)
```

git 提交:
```
PS> git init
PS> git add -A
PS> git commit -m "chore: fork dsh-approval-gate 0.5.0 as dsh-approval-core skeleton"
```
(commit hash 见最终回复)

## 自查发现(concerns)

1. **brief 文件本身是 mojibake(编码损坏)**:`task-1-brief.md` 的中文以"UTF-8 被二次 GBK 解码"的形式损坏。已通过逆转换恢复原文,确认了 `description` 与 `keywords` 的原始中文(自动审批决策管道…/自动审批),写入文件时使用恢复后的原文,而非乱码。若后续任务引用 brief 中的中文,建议重新生成一份 UTF-8 的 brief。
2. **LICENSE fork 声明位置**:brief Step 4 说"首行注释",用户补充上下文明确说"在文件末尾追加一行",二者冲突,按用户补充执行(末尾追加)。
3. **`package.json` scripts.check 引用了尚不存在的文件**(`src/danger-patterns.mjs`、`src/classifier.mjs`、`src/learning.mjs`):brief 逐字要求保留,这些文件由后续任务创建,属预期;现阶段运行 `npm run check` 会失败,`node --check src/index.mjs && node --check client.js`(Step 6 的验证命令)通过。
4. **README 链接的目标 spec 文件已存在**(`docs/specs/2026-09-06-dsh-approval-core-design.md`,90 行,规划阶段已预先创建),README 链接有效。同仓库预置的还有 `docs/superpowers/plans/2026-09-06-dsh-approval-core.md`,随 `git add -A` 一并入库,属预期。
5. `git add -A` 一并纳入了 `.superpowers/sdd/` 下的 brief 与本报告,属预期(brief 命令即 `git add -A`)。

## 产物清单

- `package.json` — 插件清单(骨架)
- `cordis.patch.yml` — bundle patch(plugin row)
- `LICENSE` — MIT(上游版权 + fork 声明)
- `README.md` — 骨架 README
- `src/index.mjs` — 上游服务端入口(逐字节复制)
- `client.js` — 上游 web client(逐字节复制)
- `.superpowers/sdd/task-1-report.md` — 本报告
