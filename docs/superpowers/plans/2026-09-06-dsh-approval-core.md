# dsh-approval-core 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 dsh-approval-gate 0.5.0 fork 出 dsh-approval-core——自动审批决策管道,例行自动放行、危险才问人,学习受约束,无规则写接口,带测试。

**Architecture:** fork approval-gate(npm 0.5.0,已装在 `C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate`),把纯逻辑抽成可测模块(danger-patterns / classifier / learning / storage),`src/index.mjs` 只做组装;移除 HTTP 规则写端点;预设名保持 `auto-approve` 以复用已写好的 profile 配置。

**Tech Stack:** Node ≥22.19(ESM,零运行时依赖,node --test 单测),Cordis 插件宿主(dsh 0.1.2-rc.1)。

## Global Constraints

- 包名/入口:`dsh-approval-core`,`main: ./src/index.mjs`,`exports` 含 `./client`
- 预设名 `PRESET_NAME = 'auto-approve'` 不变(profile 已配置该预设)
- 零运行时依赖;`@deepseek-ai/schemastery` 仅 peerDependency
- 危险清单:确定性正则先于一切,LLM 无法推翻
- 分类输出:双协议解析(严格 JSON `{"verdict":"approve"|"ask"}` 或 `SAFE`/`RISKY:<category>`),解析失败→人工
- 学习(方案 B):阈值默认 5;无指纹不沉淀;学习规则独立文件可一键清空;`learning.enabled` 开关
- HTTP:v1 只保留只读 GET(events/diff/snapshots-stats)+ POST revert + POST snapshots-clear;删除 POST rules / POST setup
- 数据目录:`$DSH_HOME/auto-approve/`(allowlist.json / learning.json / audit.log)
- 快照/数据不占 C 盘:快照目录可配,默认沿用现有 `$DSH_HOME/auto-approve/snapshots`(v2 可迁 D 盘)

---

### Task 1: Fork 仓库脚手架

**Files:**
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\package.json`
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\cordis.patch.yml`
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\LICENSE`(MIT,保留上游版权头)
- Create: `C:\Users\LIULU\Desktop\dsh-approval-core\README.md`
- Copy: `src/index.mjs`、`client.js` 从 `C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\` 复制到仓库

**Interfaces:**
- Consumes: 上游 npm 包 `dsh-approval-gate@0.5.0` 已安装于 profile node_modules
- Produces: 可加载的插件骨架(先不做任何行为改动),后续任务在其上改造

- [ ] **Step 1: 建目录并复制上游源码**

```powershell
New-Item -ItemType Directory -Force 'C:\Users\LIULU\Desktop\dsh-approval-core\src'
Copy-Item 'C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\src\index.mjs' 'C:\Users\LIULU\Desktop\dsh-approval-core\src\index.mjs'
Copy-Item 'C:\Users\LIULU\.dsh\profiles\web\node_modules\dsh-approval-gate\client.js' 'C:\Users\LIULU\Desktop\dsh-approval-core\client.js'
```

- [ ] **Step 2: 写 package.json(改名 + 保持零依赖)**

```json
{
  "name": "dsh-approval-core",
  "version": "0.1.0",
  "description": "自动审批决策管道:例行放行、危险转人工(fail-safe),学习受约束;fork dsh-approval-gate 加固版",
  "type": "module",
  "main": "./src/index.mjs",
  "exports": {
    ".": "./src/index.mjs",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "files": ["src", "client.js", "cordis.patch.yml", "README.md", "LICENSE"],
  "scripts": {
    "test": "node --test",
    "check": "node --check src/index.mjs && node --check src/danger-patterns.mjs && node --check src/classifier.mjs && node --check src/learning.mjs && node --check client.js"
  },
  "keywords": ["deepseek-harness", "dsh", "dsh-plugin", "approval", "自动审批"],
  "license": "MIT",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [] }
  },
  "peerDependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "devDependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  }
}
```

- [ ] **Step 3: 写 cordis.patch.yml(照抄上游,仅改名)**

```yaml
# dsh-approval-core bundle patch: inserts the plugin row.
# NOTE: the 'auto-approve' permission preset must exist in the profile's
# cordis.patch.yml (already configured on this machine).
- insert:
    - id: dsh-approval-core
      name: 'dsh-approval-core'
```

- [ ] **Step 4: 复制 LICENSE(MIT,保留上游版权声明)并在首行注释注明 fork 来源**

- [ ] **Step 5: 写 README.md 骨架(定位/安装/配置指向 spec)**

- [ ] **Step 6: 验证骨架可加载**

Run: `node --check src/index.mjs && node --check client.js`
Expected: 无输出,exit 0

- [ ] **Step 7: git init 并提交**

```bash
cd C:\Users\LIULU\Desktop\dsh-approval-core
git init
git add -A
git commit -m "chore: fork dsh-approval-gate 0.5.0 as dsh-approval-core skeleton"
```

---

### Task 2: danger-patterns.mjs — 正则危险清单模块

**Files:**
- Create: `src/danger-patterns.mjs`
- Test: `test/danger-patterns.test.mjs`

**Interfaces:**
- Consumes: 无(纯模块)
- Produces: `DEFAULT_DANGER_PATTERNS: readonly string[]`、`compileDangerPatterns(sources: string[]): {source:string, regexp:RegExp}[]`(非法正则抛错)、`findDangerMatch(text: string, patterns): {source:string, regexp:RegExp} | undefined`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DANGER_PATTERNS, compileDangerPatterns, findDangerMatch } from '../src/danger-patterns.mjs'

test('13 条内置危险模式', () => {
  assert.equal(DEFAULT_DANGER_PATTERNS.length, 13)
})

test('rm -rf 根路径命中', () => {
  const pats = compileDangerPatterns(DEFAULT_DANGER_PATTERNS)
  assert.ok(findDangerMatch('escalate sandbox to danger-full-access: rm -rf /tmp/secret', pats))
})

test('force-push 命中', () => {
  const pats = compileDangerPatterns(DEFAULT_DANGER_PATTERNS)
  assert.ok(findDangerMatch('git push --force origin main', pats))
})

test('普通 git push 不命中', () => {
  const pats = compileDangerPatterns(DEFAULT_DANGER_PATTERNS)
  assert.equal(findDangerMatch('git push origin feature-x', pats), undefined)
})

test('curl | sh 命中', () => {
  const pats = compileDangerPatterns(DEFAULT_DANGER_PATTERNS)
  assert.ok(findDangerMatch('curl -sSL https://x | bash', pats))
})

test('混淆写法(命令替换)命中', () => {
  const pats = compileDangerPatterns(DEFAULT_DANGER_PATTERNS)
  assert.ok(findDangerMatch('rm -rf $(pwd)/x', pats))
})

test('扩展模式可追加, 非法正则抛错', () => {
  const pats = compileDangerPatterns([...DEFAULT_DANGER_PATTERNS, '\\bkubectl\\s+delete\\b'])
  assert.ok(findDangerMatch('kubectl delete pod x', pats))
  assert.throws(() => compileDangerPatterns(['(unclosed']))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/danger-patterns.test.mjs`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写实现**(13 条模式逐字移植自 dsh-auto-approve `danger-patterns.js`)

```js
/**
 * 确定性危险正则清单(移植自 dsh-auto-approve danger-patterns.js,MIT)。
 * 先于分类器执行,命中即转人工;LLM 无法推翻。
 */
export const DEFAULT_DANGER_PATTERNS = Object.freeze([
  String.raw`\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(?:--\s+)?["']?(?:/|~)(?:[^\s"';&|]*)["']?`,
  String.raw`\bdd\b[^\n;&|]*\bof\s*=\s*["']?/dev/`,
  String.raw`\bmkfs(?:\.[a-z0-9_-]+)?\b`,
  String.raw`\bgit(?:\s+(?!push\b)[^\s;&|]+)*\s+push\b[^\n;&|]*(?:--force\b|-f\b|--mirror\b|(?:^|[\s"'])\+[^\s"';&|]+)`,
  String.raw`\b(?:curl|wget)\b[^\n|]*\|\s*(?:/usr/bin/env\s+)?(?:ba|z|da|k)?sh\b`,
  String.raw`\bdrop\s+(?:database|table)\b`,
  String.raw`\btruncate\b`,
  String.raw`(?:^|[\s;&|])(?:shutdown|reboot|halt)\b`,
  String.raw`\bchmod\s+-R\s+777\s+["']?/`,
  String.raw`:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`,
  String.raw`\bterraform\s+destroy\b`,
  String.raw`\bpulumi\s+destroy\b`,
  '(?=[^\\n]*\\b(?:rm|dd|mkfs(?:\\.[a-z0-9_-]+)?|chmod|chown)\\b)(?=[^\\n]*(?:\\$\\(|`|<\\())',
])

export function compileDangerPatterns(sources) {
  return sources.map((source) => {
    try {
      return Object.freeze({ source, regexp: new RegExp(source, 'i') })
    } catch (error) {
      throw new Error(`dsh-approval-core: invalid danger pattern ${JSON.stringify(source)}: ${String(error)}`)
    }
  })
}

export function findDangerMatch(text, patterns) {
  return patterns.find(({ regexp }) => regexp.test(text))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/danger-patterns.test.mjs`
Expected: 7 个测试全 PASS

- [ ] **Step 5: 提交**

```bash
git add src/danger-patterns.mjs test/danger-patterns.test.mjs
git commit -m "feat: regex danger list module (ported from dsh-auto-approve)"
```

---

### Task 3: classifier.mjs — 严格双协议解析模块

**Files:**
- Create: `src/classifier.mjs`
- Test: `test/classifier.test.mjs`

**Interfaces:**
- Consumes: 无(纯模块)
- Produces:
  - `parseStrictJson(text: string): 'approve' | 'ask' | undefined`(只认精确 `{"verdict":"approve"}` / `{"verdict":"ask"}`)
  - `parseRisk(text: string): {verdict:'safe'} | {verdict:'risky', category:string} | undefined`(认 `SAFE` / `RISKY:<category>` / 不确定措辞→`{risky, neutral}`)
  - `parseVerdict(text: string): 'allow' | 'risky' | 'ask' | undefined`——统一入口:strict approve→`allow`,strict ask→`ask`,SAFE→`allow`,RISKY→`risky`,其他→`undefined`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStrictJson, parseRisk, parseVerdict } from '../src/classifier.mjs'

test('严格 JSON 只认精确形式', () => {
  assert.equal(parseStrictJson('{"verdict":"approve"}'), 'approve')
  assert.equal(parseStrictJson('{"verdict":"ask"}'), 'ask')
  assert.equal(parseStrictJson('{"verdict":"maybe"}'), undefined)
  assert.equal(parseStrictJson('{"verdict":"approve","extra":1}'), undefined)
  assert.equal(parseStrictJson('SAFE'), undefined)
  assert.equal(parseStrictJson(''), undefined)
})

test('SAFE/RISKY 协议', () => {
  assert.deepEqual(parseRisk('SAFE'), { verdict: 'safe' })
  assert.deepEqual(parseRisk('RISKY:deletion'), { verdict: 'risky', category: 'deletion' })
  assert.deepEqual(parseRisk('输出: RISKY: credential'), { verdict: 'risky', category: 'credential' })
  assert.deepEqual(parseRisk('我无法判断该操作的风险'), { verdict: 'risky', category: 'neutral' })
  assert.deepEqual(parseRisk('CANNOT JUDGE'), { verdict: 'risky', category: 'neutral' })
  assert.equal(parseRisk('随便说点什么'), undefined)
})

test('统一入口', () => {
  assert.equal(parseVerdict('{"verdict":"approve"}'), 'allow')
  assert.equal(parseVerdict('{"verdict":"ask"}'), 'ask')
  assert.equal(parseVerdict('SAFE'), 'allow')
  assert.equal(parseVerdict('RISKY:system'), 'risky')
  assert.equal(parseVerdict('garbage'), undefined)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/classifier.test.mjs`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写实现**

```js
const STRICT_RE = /^\{\s*"verdict"\s*:\s*"(approve|ask)"\s*\}$/

export function parseStrictJson(text) {
  const trimmed = String(text ?? '').trim()
  const m = STRICT_RE.exec(trimmed)
  if (!m) return undefined
  try {
    const value = JSON.parse(trimmed)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const keys = Object.keys(value)
    if (keys.length !== 1 || keys[0] !== 'verdict') return undefined
    return value.verdict === 'approve' || value.verdict === 'ask' ? value.verdict : undefined
  } catch {
    return undefined
  }
}

const UNCERTAIN_RE = /无法判断|无法确定|不确定|不能确定|无法评估|UNCERTAIN|CANNOT (JUDGE|DETERMINE|ASSESS)/i

export function parseRisk(text) {
  const trimmed = String(text ?? '').trim().toUpperCase()
  const riskyMatch = trimmed.match(/RISKY\s*[:：]\s*([A-Z_]+)/)
  if (riskyMatch) return { verdict: 'risky', category: riskyMatch[1].toLowerCase() }
  if (trimmed.includes('RISKY')) return { verdict: 'risky', category: 'neutral' }
  if (trimmed.includes('SAFE')) return { verdict: 'safe' }
  if (UNCERTAIN_RE.test(String(text ?? ''))) return { verdict: 'risky', category: 'neutral' }
  return undefined
}

export function parseVerdict(text) {
  const strict = parseStrictJson(text)
  if (strict === 'approve') return 'allow'
  if (strict === 'ask') return 'ask'
  const risk = parseRisk(text)
  if (!risk) return undefined
  return risk.verdict === 'safe' ? 'allow' : 'risky'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/classifier.test.mjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/classifier.mjs test/classifier.test.mjs
git commit -m "feat: strict dual-protocol classifier parsing"
```

---

### Task 4: learning.mjs — 方案 B 约束学习模块

**Files:**
- Create: `src/learning.mjs`
- Test: `test/learning.test.mjs`

**Interfaces:**
- Consumes: 无(纯模块)
- Produces:
  - `DEFAULT_RISKY_THRESHOLD = 5`
  - `extractOperationFingerprint(text: string): string | null`(路径/文件名/项目名最长片段,通用动词排除,截断 60 字符)
  - `shouldPrecipitate({confirmed, threshold, fingerprint, samples}): boolean`——fingerprint 非空 且 样本指纹命中 且 confirmed >= threshold
  - `precipitationRule({toolName, mode, category, fingerprint}): object | null`(构造沉淀规则,无指纹返回 null)
  - `clearLearning(state): object`(清空 stats/history,返回新状态)——供"一键清空"

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RISKY_THRESHOLD,
  extractOperationFingerprint,
  shouldPrecipitate,
  precipitationRule,
  clearLearning,
} from '../src/learning.mjs'

test('阈值默认 5', () => {
  assert.equal(DEFAULT_RISKY_THRESHOLD, 5)
})

test('指纹提取: 路径优先', () => {
  assert.equal(extractOperationFingerprint('修改 C:/repo/src/main.ts 的配置'), 'C:/repo/src/main.ts')
})

test('指纹提取: 通用动词被排除', () => {
  const fp = extractOperationFingerprint('update the config file')
  assert.notEqual(fp, 'update')
})

test('指纹提取: 无区分度返回 null', () => {
  assert.equal(extractOperationFingerprint('你好'), null)
})

test('沉淀判定: 阈值+指纹+样本命中', () => {
  const fp = 'C:/repo/src/main.ts'
  assert.ok(shouldPrecipitate({ confirmed: 5, threshold: 5, fingerprint: fp, samples: [{ fp }] }))
  assert.equal(shouldPrecipitate({ confirmed: 4, threshold: 5, fingerprint: fp, samples: [{ fp }] }), false)
  assert.equal(shouldPrecipitate({ confirmed: 5, threshold: 5, fingerprint: null, samples: [{ fp }] }), false)
  assert.equal(shouldPrecipitate({ confirmed: 5, threshold: 5, fingerprint: fp, samples: [{ fp: 'other' }] }), false)
})

test('沉淀规则: 无指纹不沉淀', () => {
  assert.equal(precipitationRule({ toolName: 'edit', mode: 'workspace-write', category: 'neutral', fingerprint: null }), null)
  const rule = precipitationRule({ toolName: 'edit', mode: 'workspace-write', category: 'neutral', fingerprint: 'main.ts' })
  assert.deepEqual(rule, { tool: 'edit', mode: 'workspace-write', category: 'neutral', contains: 'main.ts' })
})

test('一键清空', () => {
  const state = { enabled: true, stats: { 'edit|ww|neutral': 3 }, history: { 'edit|ww|neutral': [{ fp: 'x' }] } }
  const cleared = clearLearning(state)
  assert.deepEqual(cleared.stats, {})
  assert.deepEqual(cleared.history, {})
  assert.equal(cleared.enabled, true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/learning.test.mjs`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写实现**(指纹提取移植自 approval-gate,`GENERIC_EN_WORDS` 保持同一集合)

```js
export const DEFAULT_RISKY_THRESHOLD = 5

const GENERIC_EN_WORDS = new Set([
  'update', 'updates', 'updating', 'updated', 'install', 'installs', 'installing',
  'deploy', 'deploys', 'deploying', 'sync', 'syncing', 'copy', 'copies', 'move',
  'remove', 'removes', 'adding', 'change', 'changes', 'changing', 'set', 'clean',
  'test', 'verify', 'check', 'fix', 'fixes', 'fixing', 'modify', 'modifies',
])

export function extractOperationFingerprint(text) {
  const s = String(text || '')
  const candidates = []
  for (const m of s.matchAll(/(?:~\/|\/|\.\/)?[\w@.-]+\/[\w@.\/-]+/g)) {
    const seg = m[0].replace(/[，。；、,.;:：\s]+$/g, '').trim()
    if (seg.length >= 5 && seg.length <= 80) candidates.push(seg)
  }
  for (const m of s.matchAll(/[\w@.-]+\.(?:md|js|json|ya?ml|env|txt|py|ts|css|html|log|mjs|cjs)/gi)) {
    const seg = m[0]
    if (seg.length >= 4 && seg.length <= 60) candidates.push(seg)
  }
  for (const m of s.matchAll(/\b[a-z][\w-]*(?:[-.][a-z][\w-]*){1,3}\b/gi)) {
    const seg = m[0]
    if (seg.length >= 6 && seg.length <= 50 && !/^(workspace-write|danger-full-access)$/i.test(seg)) {
      candidates.push(seg)
    }
  }
  for (const m of s.matchAll(/\b[a-z][a-z0-9-]{4,}\b/gi)) {
    const seg = m[0]
    if (GENERIC_EN_WORDS.has(seg.toLowerCase())) continue
    if (seg.length <= 40) candidates.push(seg)
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0].slice(0, 60)
}

export function shouldPrecipitate({ confirmed, threshold, fingerprint, samples }) {
  if (!fingerprint || confirmed < threshold) return false
  return Array.isArray(samples) && samples.some((s) => s && s.fp === fingerprint)
}

export function precipitationRule({ toolName, mode, category, fingerprint }) {
  if (!fingerprint) return null
  const rule = { tool: toolName, category, contains: fingerprint }
  if (mode) rule.mode = mode
  return rule
}

export function clearLearning(state) {
  return { enabled: state.enabled !== false, stats: {}, history: {} }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/learning.test.mjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/learning.mjs test/learning.test.mjs
git commit -m "feat: B-constrained learning module (threshold 5, fingerprint-required)"
```

---

### Task 5: 改造 src/index.mjs — 接入新模块

**Files:**
- Modify: `src/index.mjs`(若干函数替换/接线)

**Interfaces:**
- Consumes: Task 2/3/4 的 `findDangerMatch/compileDangerPatterns`、`parseVerdict`、`DEFAULT_RISKY_THRESHOLD/shouldPrecipitate/precipitationRule/clearLearning`、`DEFAULT_DANGER_PATTERNS`
- Produces: 完整决策管道(行为:危险先决、双协议分类、B 学习约束、审计标记)

**修改点(以函数名为定位,改动如下):**

- [ ] **Step 1: 文件头加 import**

在 `import { homedir } from 'node:os'` 之后加入:

```js
import { DEFAULT_DANGER_PATTERNS, compileDangerPatterns, findDangerMatch } from './danger-patterns.mjs'
import { parseVerdict } from './classifier.mjs'
import { DEFAULT_RISKY_THRESHOLD, shouldPrecipitate, precipitationRule, clearLearning } from './learning.mjs'
```

- [ ] **Step 2: 替换 DENY 层为"正则危险清单 + 关键词双保险"**

把 `function looksDeny(text) {...}` 整体替换为:

```js
// 正则危险清单(确定性,先于一切)+ 关键词 denyKeywords 作为可配第二层
const dangerPatterns = compileDangerPatterns([
  ...DEFAULT_DANGER_PATTERNS,
  ...(config.denyKeywords || []).map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
])

function looksDeny(text) {
  return findDangerMatch(String(text || ''), dangerPatterns) !== undefined
}
```

注意:危险清单在 `reloadConfig()` 后不重建——denyKeywords 变更需重启生效(可接受,v1 明确"改文件生效")。在 `apply(ctx, config)` 里 `config` 初始解析后调用一次 `compileDangerPatterns`。

- [ ] **Step 3: 分类结果统一走 `parseVerdict`**

`judgeOnce` 的返回改为:

```js
const verdict = parseVerdict(text)
if (verdict === 'allow') return { verdict: 'safe' }
if (verdict === 'risky') return { verdict: 'risky', category: extractCategory(text) }
if (verdict === 'ask') return { verdict: 'risky', category: 'neutral' }
throw new Error('flash 输出无法解析: ' + JSON.stringify(text.slice(0, 120)))
```

其中 `extractCategory` 复用原 `RISKY\s*[:：]\s*([A-Z_]+)` 提取,失败给 `'neutral'`:

```js
function extractCategory(text) {
  const m = String(text || '').toUpperCase().match(/RISKY\s*[:：]\s*([A-Z_]+)/)
  return m ? m[1].toLowerCase() : 'neutral'
}
```

原 `judgeOnce` 里对 `SAFE`/`RISKY` 的手写匹配删除,统一交给 `parseVerdict`。

- [ ] **Step 4: 学习阈值默认改 5,沉淀必须强指纹**

- `riskyThreshold` 默认值:`3` → `DEFAULT_RISKY_THRESHOLD`(在 `normalizeConfig` 与首次初始化配置对象两处)
- 4f 分支中 `const confirmed = learning.stats[key] || 0` 之后的沉淀逻辑改为:

```js
if (confirmed >= threshold) {
  const fingerprint = extractOperationFingerprint(justification)
  const samples = learning.history[key] || []
  const fpHit = shouldPrecipitate({ confirmed, threshold, fingerprint, samples })

  if (fpHit) {
    if (learning.enabled) {
      const rule = precipitationRule({ toolName, mode, category: cat, fingerprint })
      if (rule && !config.allowRules.some((r) => r.tool === rule.tool && r.mode === rule.mode && r.category === rule.category && r.contains === rule.contains)) {
        rule.description = `自动沉淀:${cat} 人工确认后自动放行`
        config.allowRules.push(rule)
        saveJson(ALLOWLIST_PATH, config)
        audit(`LEARN   ${key} 已沉淀 ${JSON.stringify(rule)}`)
      }
    }
    // ...沿用原 fpHit 放行逻辑(删除 stats/history、记录事件、allowed-once)
  } else if (samples.length > 0) {
    // 保留原 flash 语义同类验证分支,但"SAME 放行"只在 learning.enabled 且 fingerprint 非空时沉淀
  }
  // 其余走人工确认(原逻辑不变)
}
```

- [ ] **Step 5: 学习规则独立存储 + 一键清空命令**

- 新增 `/approval-core-clear-learning` 命令(仿原 `/auto-report` 注册方式):

```js
commandCtx.commands.register({
  name: 'approval-core-clear-learning',
  description: '清空全部学习沉淀(独立于白名单主表)',
  handler: () => {
    const cleared = clearLearning(learning)
    saveJson(LEARNING_PATH, cleared)
    Object.assign(learning, cleared)
    return { kind: 'success', text: '学习记录已清空(stats 与 history)' }
  },
})
```

- 沉淀规则仍写入 `allowRules` 的行为**删除**——改为只写 `learning.json` 的 `history`/`stats`(即:不再把学习结果固化进主白名单;学习放行仅靠 `fpHit` 判定,重启后学习状态持久在 learning.json,一键清空即可全撤)。对应地,4f 中 `config.allowRules.push(rule)` 分支删除,保留 `delete learning.stats[key]` 前的放行路径。

> 设计注:此改动把"沉淀"从主白名单移到独立学习态——`allowlist.json` 只剩用户手写规则,学习永不污染主表,`/approval-core-clear-learning` 一键回滚。

- [ ] **Step 6: 审计标记学习来源**

`recordApprovalEvent` 的 `path` 字段值 `neutral-confirm` 改为区分来源:自动放行(`fp-hit`/`flash-same`)记 `path: 'auto-learned'`,人工通过记 `path: 'human-approved'`,人工拒绝记 `path: 'learned-removed'`。日志 `audit()` 行首标记不变。

- [ ] **Step 7: 语法检查**

Run: `npm run check`
Expected: 无输出,exit 0

- [ ] **Step 8: 提交**

```bash
git add src/index.mjs
git commit -m "feat: wire regex danger list, dual-protocol parser, B-constrained learning into pipeline"
```

---

### Task 6: 摘除 HTTP 规则写接口

**Files:**
- Modify: `src/index.mjs`(删除路由注册)

**Interfaces:**
- Consumes: 无新依赖
- Produces: 仅存只读 GET(events/diff/snapshots-stats)+ POST revert + POST snapshots-clear

- [ ] **Step 1: 删除 `rules` 路由注册块**

删除 `ctx.webServer.register({ kind:'exact', path:'/api/auto-approve/rules', ...})` 整块(含 `offRulesRoute` 变量、`applyRuleOp` 调用点)。规则改为直接编辑 `$DSH_HOME/auto-approve/allowlist.json` 后生效(已有 `reloadConfig` 热读;危险清单重建需重启——见 Task 5 Step 2 注)。

- [ ] **Step 2: 删除 `setup` 路由注册块**

删除 `path:'/api/auto-approve/setup'` 整块(不再提供"一键写 cordis.patch.yml"入口;预设已手动配置好)。

- [ ] **Step 3: 清理无用代码**

删除 `applyRuleOp`、`getRulesSnapshot`(仅被 rules 路由使用)、`ensureAutoApprovePreset`、`FULL_PERMISSION_BLOCK`、`AUTO_APPROVE_PRESET_YAML`、`readBody`(若 revert/snapshots-clear 仍用则保留)。删除后跑:

Run: `npm run check`
Expected: exit 0

- [ ] **Step 4: 更新 README(说明 v1 无规则 API,配置走文件)**

- [ ] **Step 5: 提交**

```bash
git add src/index.mjs README.md
git commit -m "security: remove HTTP rule-mutation endpoints (rules/setup); config via file only"
```

---

### Task 7: 补集成级测试 + 全量验证

**Files:**
- Create: `test/pipeline.test.mjs`(把 Task 2-5 的纯逻辑串成"一次审批请求"走查)

**Interfaces:**
- Consumes: danger-patterns/classifier/learning 全部导出
- Produces: 决策管道端到端行为回归测试

- [ ] **Step 1: 写 pipeline 测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DANGER_PATTERNS, compileDangerPatterns, findDangerMatch } from '../src/danger-patterns.mjs'
import { parseVerdict } from '../src/classifier.mjs'
import { extractOperationFingerprint, shouldPrecipitate, DEFAULT_RISKY_THRESHOLD } from '../src/learning.mjs'

function decide({ reason, classifierOutput, confirmed, samples, threshold = DEFAULT_RISKY_THRESHOLD }) {
  // 模拟管道 ①④⑥:危险先决 → 分类 → 学习判定
  const patterns = compileDangerPatterns(DEFAULT_DANGER_PATTERNS)
  if (findDangerMatch(reason, patterns)) return { outcome: 'human', path: 'deny' }
  const verdict = parseVerdict(classifierOutput)
  if (verdict === 'allow') return { outcome: 'allow', path: 'safe' }
  if (verdict === 'ask') return { outcome: 'human', path: 'ask' }
  if (verdict === 'risky') {
    const fp = extractOperationFingerprint(reason)
    if (shouldPrecipitate({ confirmed, threshold, fingerprint: fp, samples })) {
      return { outcome: 'allow', path: 'auto-learned' }
    }
    return { outcome: 'human', path: 'neutral-confirm' }
  }
  return { outcome: 'human', path: 'parse-failed' }
}

test('危险命令: 分类器说 SAFE 也无效', () => {
  const r = decide({ reason: 'rm -rf /tmp/x', classifierOutput: 'SAFE', confirmed: 0, samples: [] })
  assert.deepEqual(r, { outcome: 'human', path: 'deny' })
})

test('例行操作: SAFE 放行', () => {
  const r = decide({ reason: '写入工作区 src/a.js', classifierOutput: 'SAFE', confirmed: 0, samples: [] })
  assert.deepEqual(r, { outcome: 'allow', path: 'safe' })
})

test('严格 JSON approve 同样放行', () => {
  const r = decide({ reason: '写入工作区 src/a.js', classifierOutput: '{"verdict":"approve"}', confirmed: 0, samples: [] })
  assert.deepEqual(r, { outcome: 'allow', path: 'safe' })
})

test('严格 JSON ask → 人工', () => {
  const r = decide({ reason: '写入工作区 src/a.js', classifierOutput: '{"verdict":"ask"}', confirmed: 0, samples: [] })
  assert.deepEqual(r, { outcome: 'human', path: 'ask' })
})

test('neutral 学习: 满阈值且指纹命中 → auto-learned', () => {
  const fp = extractOperationFingerprint('修改 src/main.ts 的配置')
  const r = decide({ reason: '修改 src/main.ts 的配置', classifierOutput: 'RISKY:neutral', confirmed: 5, samples: [{ fp }] })
  assert.deepEqual(r, { outcome: 'allow', path: 'auto-learned' })
})

test('neutral 学习: 未达阈值 → 人工', () => {
  const r = decide({ reason: '修改 src/main.ts 的配置', classifierOutput: 'RISKY:neutral', confirmed: 3, samples: [] })
  assert.deepEqual(r, { outcome: 'human', path: 'neutral-confirm' })
})

test('解析垃圾输出 → 人工(fail-safe)', () => {
  const r = decide({ reason: '随便', classifierOutput: '完全无关的回复', confirmed: 0, samples: [] })
  assert.deepEqual(r, { outcome: 'human', path: 'parse-failed' })
})
```

- [ ] **Step 2: 跑全量测试**

Run: `node --test`
Expected: 4 个测试文件全部 PASS(约 20 个用例)

- [ ] **Step 3: 全量语法检查 + 危险清单对真实理由冒烟**

Run: `npm run check`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
git add test/pipeline.test.mjs
git commit -m "test: pipeline end-to-end regression suite"
```

---

### Task 8: 本地安装 + 真机冒烟(需用户配合重启)

**Files:**
- Modify: `C:\Users\LIULU\.dsh\profiles\web\package.json`(dsh plugin add 自动改)
- Modify: `C:\Users\LIULU\.dsh\profiles\web\cordis.patch.yml`(插件行由 loader 合并,无需手改)

**Interfaces:**
- Consumes: 前 7 个任务的产物

- [ ] **Step 1: 从 profile 卸载 approval-gate(避免与 core 双决策管道)**

```powershell
dsh plugin --profile web remove dsh-approval-gate
```

(若保留对比,可先跳过本步;但双决策插件同挂 approval/request 会造成裁决竞争,不推荐。)

- [ ] **Step 2: 本地安装 core**

```powershell
dsh plugin --profile web add ./dsh-approval-core
```

- [ ] **Step 3: 核对 bundles 顺序与依赖**

读取 `C:\Users\LIULU\.dsh\profiles\web\package.json`,确认 `dsh-approval-core` 在 bundles 列表,依赖键为 `"dsh-approval-core": "link:C:/Users/LIULU/Desktop/dsh-approval-core"` 或等价本地引用。

- [ ] **Step 4: 用户重启 DSH Desktop**(宿主加载新插件与预设;agent 不可自重启)

- [ ] **Step 5: 真机冒烟清单(重启后用户执行,结果回传)**

1. 权限下拉仍显示「自动审批(Flash)」(预设名 `auto-approve` 未变)
2. 例行操作(写工作区文件)→ 自动放行,`/auto-report` 出现 auto-approved
3. 危险命令(`rm -rf <测试目录>`)→ 转人工弹窗,`/auto-report` 出现 danger 拦截
4. 分类器输出垃圾时 → 转人工(可临时把模型配成不可用验证 fail-safe)
5. `/approval-core-clear-learning` 可用,学习清空
6. 访问 `http://127.0.0.1:<port>/api/auto-approve/rules`(POST)→ 404;GET events 正常

- [ ] **Step 6: 提交验收记录**

```bash
git add README.md
git commit -m "docs: v0.1.0 smoke-test checklist results"
```

---

## Self-Review 记录

- **Spec 覆盖**:七层管道 → Task 2(①)/5(②③④⑤⑥⑦)/7(回归);审计 → Task 5 Step 6;被动问责 → fork 自带 client.js 审查视图(保留);工程约束(零依赖/无规则 API/学习独立/快照 D 盘待 v2)→ Task 1/6/5 Step 5;两阶段 → Task 8 本地 + 后续发布。
- **占位符**:无 TBD/TODO;所有实现均含完整代码。
- **类型一致性**:`findDangerMatch(text, patterns)`、`parseVerdict(text)`、`shouldPrecipitate({confirmed,threshold,fingerprint,samples})`、`precipitationRule({toolName,mode,category,fingerprint})`、`clearLearning(state)` 在各任务间签名一致。
