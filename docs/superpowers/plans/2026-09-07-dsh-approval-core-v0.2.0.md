# dsh-approval-core v0.2.0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 dsh-approval-core 增加分级权限的配置 UI(服务端校验)、移植上游 0.5.2 的 diff 快照修复、数据目录可配置(含 D 盘)、分类模型可配,并完成代码清理。

**Architecture:** 服务端新增 `configRules.mjs` 纯模块承载四级权限矩阵与校验逻辑(TDD 核心);`src/index.mjs` 恢复受限的 POST /rules 路由(只走校验模块);`client.js` 恢复完整设置页并按权限分级渲染;数据目录改为 `allowlist.json` 的 `dataDir` 字段驱动(启动时解析,变更需重启);模型选择接入 `agentDefaultModel` 之外的独立配置。

**Tech Stack:** Node ≥22 ESM(零运行时依赖),node:test,既有 fork 代码库(HEAD=f8e9125)。

## Global Constraints

- 包名 `dsh-approval-core`;预设名 `PRESET_NAME='auto-approve'`;数据子目录名 `auto-approve` 语义由 `dataDir` 配置决定(默认仍为 `$DSH_HOME/auto-approve`)
- 零运行时依赖;`@deepseek-ai/schemastery` 仅 peerDependency
- 配置写接口必须经服务端四级权限矩阵校验(UI 确认只是体验层);🔴级操作服务端直接拒绝
- 预置数据(`DEFAULT_DENY_KEYWORDS`/`DEFAULT_ALLOW_RULES`/`DEFAULT_HARD_CATEGORIES`)不可被 UI 删除
- 硬风险类别(`deletion/credential/remote/system/bulk`)不可被 UI 修改
- `mode:'danger-full-access'` 不可通过 UI 加入白名单
- 学习沉淀规则 UI 只读(终止学习走已有 `clearLearning` 命令,不在 HTTP 面暴露)
- 测试进程内执行:`& 'C:\Users\LIULU\AppData\Local\hermes\node\node.exe' test\<file>.mjs`(沙箱内 `node --test` spawn EPERM)
- 每次 commit 前:`node --check` 全部改动文件 + 全量测试绿
- v0.2.0 版本号落 package.json;完成后 README 更新

---

### Task 1: configRules.mjs — 四级权限校验模块

**Files:**
- Create: `src/configRules.mjs`
- Test: `test/config-rules.test.mjs`

**Interfaces:**
- Consumes: 无(纯模块,接收注入的常量)
- Produces:
  - `PERMISSION_LEVELS`: `{ READ:'read', FREE:'free', CONFIRM:'confirm', FORBIDDEN:'forbidden' }`
  - `classifyOp({ op, kind, value, predefined, hardCategories }): { level, reason? }` — 返回操作权限级别
    - `kind ∈ denyKeywords|allowRules|denyRules|hardCategories|riskyThreshold|judgeTimeoutMs`
    - 判定顺序:未知 kind → forbidden;数值类 set → free(带范围校验);remove 命中预置 → forbidden;hardCategories 任何写 → forbidden;allowRules add 且 value.mode==='danger-full-access' → forbidden;其余 add/remove → confirm
  - `validateValue({ kind, value, op }): { ok, error?, normalized? }` — 数值范围(riskyThreshold 1-20、judgeTimeoutMs 5000-120000)与结构校验(规则对象至少含 tool/mode/category/contains 之一;denyKeywords 非空字符串 ≤64 字符)
- 纯函数,无 IO,全部可 TDD

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PERMISSION_LEVELS, classifyOp, validateValue } from '../src/configRules.mjs'

const PRESET_KW = ['rm -rf', 'shutdown']
const PRESET_RULES = [{ mode: 'workspace-write', description: '工作区写入' }]
const HARD = ['deletion', 'credential', 'remote', 'system', 'bulk']

test('权限级别常量', () => {
  assert.deepEqual(PERMISSION_LEVELS, { READ: 'read', FREE: 'free', CONFIRM: 'confirm', FORBIDDEN: 'forbidden' })
})

test('数值 set → free', () => {
  assert.equal(classifyOp({ op: 'set', kind: 'riskyThreshold', predefined: {}, hardCategories: HARD }).level, 'free')
  assert.equal(classifyOp({ op: 'set', kind: 'judgeTimeoutMs', predefined: {}, hardCategories: HARD }).level, 'free')
})

test('hardCategories 任何写操作 → forbidden', () => {
  for (const op of ['add', 'remove', 'set']) {
    assert.equal(classifyOp({ op, kind: 'hardCategories', value: 'x', predefined: { hardCategories: HARD }, hardCategories: HARD }).level, 'forbidden')
  }
})

test('删除预置 denyKeyword → forbidden; 删除自定义 → confirm', () => {
  const args = { kind: 'denyKeywords', predefined: { denyKeywords: PRESET_KW }, hardCategories: HARD }
  assert.equal(classifyOp({ ...args, op: 'remove', value: 'rm -rf' }).level, 'forbidden')
  assert.equal(classifyOp({ ...args, op: 'remove', value: 'my-custom-kw' }).level, 'confirm')
})

test('add denyKeyword → confirm', () => {
  assert.equal(classifyOp({ op: 'add', kind: 'denyKeywords', value: 'sudo rm', predefined: { denyKeywords: PRESET_KW }, hardCategories: HARD }).level, 'confirm')
})

test('allowRules: danger-full-access → forbidden; 其余 add → confirm; 预置规则 remove → forbidden', () => {
  const args = { kind: 'allowRules', predefined: { allowRules: PRESET_RULES }, hardCategories: HARD }
  assert.equal(classifyOp({ ...args, op: 'add', value: { tool: 'edit', mode: 'danger-full-access' } }).level, 'forbidden')
  assert.equal(classifyOp({ ...args, op: 'add', value: { tool: 'edit', mode: 'workspace-write' } }).level, 'confirm')
  assert.equal(classifyOp({ ...args, op: 'remove', value: { mode: 'workspace-write' } }).level, 'forbidden')
})

test('未知 kind → forbidden', () => {
  assert.equal(classifyOp({ op: 'add', kind: 'unknownKind', value: 'x', predefined: {}, hardCategories: HARD }).level, 'forbidden')
})

test('denyRules: add/remove → confirm(用户自己的拒绝规则可管理)', () => {
  const args = { kind: 'denyRules', predefined: { denyRules: [] }, hardCategories: HARD }
  assert.equal(classifyOp({ ...args, op: 'add', value: { tool: 'edit' } }).level, 'confirm')
  assert.equal(classifyOp({ ...args, op: 'remove', value: { tool: 'edit' } }).level, 'confirm')
})

test('validateValue: 数值范围', () => {
  assert.equal(validateValue({ kind: 'riskyThreshold', op: 'set', value: 5 }).ok, true)
  assert.equal(validateValue({ kind: 'riskyThreshold', op: 'set', value: 0 }).ok, false)
  assert.equal(validateValue({ kind: 'riskyThreshold', op: 'set', value: 21 }).ok, false)
  assert.equal(validateValue({ kind: 'judgeTimeoutMs', op: 'set', value: 4000 }).ok, false)
  assert.equal(validateValue({ kind: 'judgeTimeoutMs', op: 'set', value: 130000 }).ok, false)
  assert.equal(validateValue({ kind: 'riskyThreshold', op: 'add', value: 5 }).ok, false)
})

test('validateValue: 规则对象与关键词', () => {
  assert.equal(validateValue({ kind: 'allowRules', op: 'add', value: { tool: 'edit' } }).ok, true)
  assert.equal(validateValue({ kind: 'allowRules', op: 'add', value: {} }).ok, false)
  assert.equal(validateValue({ kind: 'allowRules', op: 'add', value: { tool: 123 } }).ok, false)
  assert.equal(validateValue({ kind: 'denyKeywords', op: 'add', value: '' }).ok, false)
  assert.equal(validateValue({ kind: 'denyKeywords', op: 'add', value: 'x'.repeat(65) }).ok, false)
  const r = validateValue({ kind: 'denyKeywords', op: 'add', value: '  sudo rm  ' })
  assert.equal(r.ok, true)
  assert.equal(r.normalized, 'sudo rm')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `& 'C:\Users\LIULU\AppData\Local\hermes\node\node.exe' test\config-rules.test.mjs`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写实现**

```js
/**
 * 配置写操作的四级权限矩阵与校验(纯模块)。
 * read: 只读展示; free: 自由修改; confirm: 需 UI 确认; forbidden: 服务端拒绝。
 * UI 确认只是体验层——安全边界在服务端 classifyOp。
 */
export const PERMISSION_LEVELS = Object.freeze({
  READ: 'read',
  FREE: 'free',
  CONFIRM: 'confirm',
  FORBIDDEN: 'forbidden',
})

const NUMERIC_KINDS = new Set(['riskyThreshold', 'judgeTimeoutMs'])

/** 判定一个配置写操作的权限级别。predefined: {denyKeywords?, allowRules?, hardCategories?} */
export function classifyOp({ op, kind, value, predefined, hardCategories }) {
  const KNOWN = new Set(['denyKeywords', 'allowRules', 'denyRules', 'hardCategories', 'riskyThreshold', 'judgeTimeoutMs'])
  if (!KNOWN.has(kind)) return { level: PERMISSION_LEVELS.FORBIDDEN, reason: `未知配置类型: ${kind}` }
  if (kind === 'hardCategories') return { level: PERMISSION_LEVELS.FORBIDDEN, reason: '硬风险类别不可通过 UI 修改(安全边界)' }
  if (NUMERIC_KINDS.has(kind)) {
    if (op !== 'set') return { level: PERMISSION_LEVELS.FORBIDDEN, reason: `${kind} 仅支持 set` }
    return { level: PERMISSION_LEVELS.FREE }
  }
  if (op === 'remove' || op === 'add') {
    if (kind === 'allowRules' && op === 'add') {
      const mode = value && typeof value === 'object' ? String(value.mode || '') : ''
      if (mode === 'danger-full-access') {
        return { level: PERMISSION_LEVELS.FORBIDDEN, reason: 'danger-full-access 不可通过 UI 加入白名单' }
      }
    }
    if (op === 'remove' && isPredefined(kind, value, predefined)) {
      return { level: PERMISSION_LEVELS.FORBIDDEN, reason: '预置项不可通过 UI 删除' }
    }
    return { level: PERMISSION_LEVELS.CONFIRM }
  }
  return { level: PERMISSION_LEVELS.FORBIDDEN, reason: `不支持的操作: ${op}` }
}

function isPredefined(kind, value, predefined) {
  const list = predefined && predefined[kind]
  if (!Array.isArray(list)) return false
  return list.some((item) => JSON.stringify(normalizeItem(item)) === JSON.stringify(normalizeItem(value)))
}

function normalizeItem(item) {
  if (typeof item === 'string') return item.trim()
  if (item && typeof item === 'object') {
    const { description, ...rest } = item
    return rest
  }
  return item
}

const VALUE_RULES = {
  riskyThreshold: { min: 1, max: 20, ops: ['set'] },
  judgeTimeoutMs: { min: 5000, max: 120000, ops: ['set'] },
}

/** 结构与范围校验;通过时返回 normalized(去除首尾空白等) */
export function validateValue({ kind, value, op }) {
  if (NUMERIC_KINDS.has(kind)) {
    const rule = VALUE_RULES[kind]
    if (!rule.ops.includes(op)) return { ok: false, error: `${kind} 仅支持 ${rule.ops.join('/')}` }
    const n = Number(value)
    if (!Number.isFinite(n) || n < rule.min || n > rule.max) {
      return { ok: false, error: `${kind} 必须在 ${rule.min}-${rule.max} 之间` }
    }
    return { ok: true, normalized: n }
  }
  if (kind === 'denyKeywords') {
    if (op !== 'add' && op !== 'remove') return { ok: false, error: 'denyKeywords 仅支持 add/remove' }
    if (typeof value !== 'string') return { ok: false, error: 'denyKeywords 值必须是字符串' }
    const s = value.trim()
    if (op === 'add' && (s.length === 0 || s.length > 64)) return { ok: false, error: '关键词长度需在 1-64 字符' }
    return { ok: true, normalized: s }
  }
  if (kind === 'allowRules' || kind === 'denyRules') {
    if (op !== 'add' && op !== 'remove') return { ok: false, error: `${kind} 仅支持 add/remove` }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '规则必须是对象' }
    const hasAny = ['tool', 'mode', 'category', 'contains'].some((k) => {
      const v = value[k]
      return typeof v === 'string' && v.trim().length > 0
    })
    if (!hasAny) return { ok: false, error: '规则至少需要 tool/mode/category/contains 之一(字符串)' }
    const normalized = {}
    for (const k of ['tool', 'mode', 'category', 'contains']) {
      if (typeof value[k] === 'string' && value[k].trim()) normalized[k] = value[k].trim()
    }
    return { ok: true, normalized }
  }
  return { ok: false, error: `未知配置类型: ${kind}` }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `& 'C:\Users\LIULU\AppData\Local\hermes\node\node.exe' test\config-rules.test.mjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/configRules.mjs test/config-rules.test.mjs
git commit -m "feat: config permission matrix + validation module (4-level, server-side)"
```

---

### Task 2: 服务端受限 POST /rules 路由 + 数据目录可配 + 模型可配

**Files:**
- Modify: `src/index.mjs`(路由恢复 / DATA_DIR 解析 / resolveModel 扩展)
- Modify: `src/learning.mjs`(无改动,确认)
- Test: `test/config-rules.test.mjs`(已有)、`test/pipeline.smoke.mjs`(回归)

**Interfaces:**
- Consumes: Task 1 的 `classifyOp`/`validateValue`
- Produces:
  - POST `/api/auto-approve/rules`(op/kind/value):校验链 = `classifyOp` → `validateValue` → 应用 → `saveJson`;forbidden 返回 403 `{ok:false, error:reason}`;校验失败 400;成功 200 `{ok:true}`
  - GET `/api/auto-approve/rules` 恢复(供设置页只读展示;含 `permission` 元数据:每 kind 的级别,供 UI 渲染)
  - `allowlist.json` 新增可选字段 `dataDir`(绝对路径)与 `classifierModel`(`{provider, model}`);`DATA_DIR` 解析逻辑:`dataDir` 存在且绝对路径合法 → 用之,否则回退 `$DSH_HOME/auto-approve`
  - `resolveModel()` 优先级:`classifierModel` 配置 > 会话默认模型 > 内置回退

- [ ] **Step 1: 冒烟测试先行(数据目录可配)** — 在 `test/pipeline.smoke.mjs` 追加场景 e:

```js
// 场景 e: dataDir 自定义目录 —— allowlist.json 里写 dataDir 指向临时子目录,
// apply 后确认 snapshots/events 落在自定义目录(learning/allowlist 仍在默认目录)
```

断言要点:自定义 `dataDir` 下生成 `events.jsonl`;默认目录不受影响。实现见 Step 3 的 `resolveDataDir()`。

- [ ] **Step 2: 跑冒烟确认场景 e 失败**

Run: `& 'C:\Users\LIULU\AppData\Local\hermes\node\node.exe' test\pipeline.smoke.mjs`
Expected: 场景 e FAIL(dataDir 未生效)

- [ ] **Step 3: 实现 resolveDataDir + DATA_DIR 惰性解析**

`src/index.mjs` 中,把模块顶层的:

```js
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DATA_DIR = join(DSH_HOME, 'auto-approve')
```

改为:

```js
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DEFAULT_DATA_DIR = join(DSH_HOME, 'auto-approve')
// dataDir 允许把快照/events/审计迁到任意盘(如 D:\data\dsh-approval);
// allowlist.json 本身始终在 DEFAULT_DATA_DIR(它声明了 dataDir,鸡生蛋问题)
let DATA_DIR = DEFAULT_DATA_DIR
function resolveDataDir(cfg) {
  const custom = cfg && typeof cfg.dataDir === 'string' ? cfg.dataDir.trim() : ''
  if (!custom) return DEFAULT_DATA_DIR
  // 仅接受绝对路径;相对路径视为配置错误,回退默认(fail-safe)
  if (!/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(custom)) return DEFAULT_DATA_DIR
  return custom
}
```

模块顶层的 `loadJson(ALLOWLIST_PATH, ...)` 保持不变;其后紧接:

```js
DATA_DIR = resolveDataDir(config)
const LEARNING_PATH_D = join(DATA_DIR, 'learning.json')  // 见 Step 4 说明
```

**注意**:`LEARNING_PATH`/`AUDIT_PATH`/`EVENTS_PATH`/`SNAPSHOTS_DIR` 都基于 `DATA_DIR`,改为 `let` 并在 `resolveDataDir` 后重算。`learning.json` 跟随 `DATA_DIR`(迁移 = 手动把旧文件拷到新目录,README 说明)。allowlist.json 永远留在默认目录(它声明 dataDir)。

- [ ] **Step 4: 恢复受限 POST /rules 路由**

在 events 路由注册块后加入(复用既有 `readBody`/`send` 辅助;按文件内既有风格):

```js
// ---- 配置读写 API(GET 只读 / POST 分级校验) ----
let offRulesRoute = null
try {
  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    offRulesRoute = ctx.webServer.register({
      kind: 'exact',
      path: '/api/auto-approve/rules',
      handler: async (req, res) => {
        const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        if (req.method === 'GET' || req.method === 'HEAD') {
          reloadConfig()
          return send(200, {
            config: {
              version: config.version || 3,
              denyKeywords: config.denyKeywords || [],
              allowRules: config.allowRules || [],
              denyRules: config.denyRules || [],
              hardCategories: config.hardCategories || [],
              riskyThreshold: config.riskyThreshold,
              judgeTimeoutMs: config.judgeTimeoutMs || 20000,
              learning: { enabled: learning.enabled !== false },
              dataDir: DATA_DIR,
              classifierModel: config.classifierModel || null,
            },
            learning: { stats: learning.stats || {}, history: learning.history || {} },
            predefined: {
              denyKeywords: DEFAULT_DENY_KEYWORDS,
              allowRules: DEFAULT_ALLOW_RULES,
              hardCategories: DEFAULT_HARD_CATEGORIES,
            },
            permission: {
              denyKeywords: 'confirm', allowRules: 'confirm', denyRules: 'confirm',
              hardCategories: 'forbidden', riskyThreshold: 'free', judgeTimeoutMs: 'free',
            },
          })
        }
        if (req.method !== 'POST') { send(405, { ok: false, error: 'method not allowed' }); return }
        let body
        try { body = await readBody(req) } catch (e) { return send(400, { ok: false, error: '请求体无效: ' + e.message }) }
        const op = String(body.op || ''), kind = String(body.kind || ''), value = body.value
        const verdict = classifyOp({ op, kind, value, predefined: {
          denyKeywords: DEFAULT_DENY_KEYWORDS, allowRules: DEFAULT_ALLOW_RULES, hardCategories: DEFAULT_HARD_CATEGORIES,
        }, hardCategories: config.hardCategories })
        if (verdict.level === 'forbidden') {
          audit(`CFG-DENY ${kind} op=${op} | ${verdict.reason}`)
          return send(403, { ok: false, error: verdict.reason })
        }
        const check = validateValue({ kind, value, op })
        if (!check.ok) return send(400, { ok: false, error: check.error })
        reloadConfig()
        if (kind === 'riskyThreshold' || kind === 'judgeTimeoutMs') {
          config[kind] = check.normalized
          saveJson(ALLOWLIST_PATH, config)
          audit(`CONFIG  ${kind} → ${check.normalized}`)
          return send(200, { ok: true, set: true, value: check.normalized })
        }
        const list = config[kind]
        if (op === 'add') {
          if (kind === 'denyKeywords') {
            if (!list.includes(check.normalized)) list.push(check.normalized)
          } else {
            const dup = list.some((r) => r && JSON.stringify(normalizeItem(r)) === JSON.stringify(check.normalized))
            if (!dup) {
              check.normalized.description = '用户自定义'
              list.push(check.normalized)
            }
          }
        } else {
          const idx = list.findIndex((r) => JSON.stringify(normalizeItem(r)) === JSON.stringify(check.normalized))
          if (idx >= 0) list.splice(idx, 1)
        }
        saveJson(ALLOWLIST_PATH, config)
        audit(`CONFIG  ${kind} ${op} ${JSON.stringify(check.normalized).slice(0, 120)}`)
        return send(200, { ok: true })
      },
    })
    console.log(`[${NAME}] 配置 API 已注册: /api/auto-approve/rules (GET 只读 / POST 分级校验)`)
  }
} catch (error) {
  console.error(`[${NAME}] 注册配置 API 失败`, error)
}
```

并把 `offRulesRoute` 加进既有 `ctx.effect` 注销块。`normalizeItem` 从 configRules.mjs 不导出——在 index.mjs 顶部加本地小函数或从模块导出(推荐:configRules.mjs `export function normalizeItem`,Task 1 已内联定义,补 `export` 关键字并同步测试 import)。

- [ ] **Step 5: 分类模型可配**

`resolveModel()` 改为:

```js
const resolveModel = () => {
  // 优先级: allowlist.classifierModel 显式配置 > 会话默认模型 > 内置回退
  const cm = config && config.classifierModel
  if (cm && typeof cm.provider === 'string' && cm.provider && typeof cm.model === 'string' && cm.model) {
    return { provider: cm.provider, model: cm.model }
  }
  try {
    const sel = agentDefaultModel && typeof agentDefaultModel.currentSelection === 'function'
      ? agentDefaultModel.currentSelection()
      : undefined
    if (sel && typeof sel.provider === 'string' && sel.provider && typeof sel.model === 'string' && sel.model) {
      return { provider: sel.provider, model: sel.model }
    }
  } catch (error) {
    console.error(`[${NAME}] agentDefaultModel.currentSelection() failed`, error)
  }
  return { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
}
```

`normalizeConfig` 补:`cfg.classifierModel = cfg.classifierModel || null`(无校——错误配置自然回落会话默认模型)。POST /rules 不开放 classifierModel 修改(编辑文件生效,避免 UI 误配烧 token;README 说明)。

- [ ] **Step 6: 全量验证**

Run: `& 'C:\Users\LIULU\AppData\Local\hermes\node\node.exe' test\config-rules.test.mjs`(全 PASS)
Run: `& 'C:\Users\LIULU\AppData\Local\hermes\node\node.exe' test\pipeline.smoke.mjs`(SMOKE PASS 含场景 e)
Run: `node --check src\index.mjs src\configRules.mjs`

- [ ] **Step 7: 提交**

```bash
git add src/index.mjs src/configRules.mjs test/pipeline.smoke.mjs
git commit -m "feat: server-side gated POST /rules, configurable dataDir + classifierModel"
```

---

### Task 3: 移植上游 0.5.2 diff 快照修复

**Files:**
- Modify: `src/index.mjs`(resolveToolCallFiles + saveEventSnapshots 过滤 + files 接线)

**Interfaces:**
- Consumes: 上游 commit d3e6304 + 8419bc3 的实现(见 https://github.com/moon09300731/dsh-approval-gate/commit/d3e6304 与 8419bc3,MIT)
- Produces: `resolveToolCallFiles(callId, events): string[]|null`;recordApprovalEvent 的 `opts.files` 覆盖;快照设备/空内容过滤

- [ ] **Step 1: 移植 resolveToolCallFiles**

从上游 main 的 src/index.mjs 原样复制 `resolveToolCallFiles(callId, events)` 函数(含 `extractFiles` 既有实现复用;上游该函数使用 `session.events` 数组——注意我们的调用点要传 `session.snapshotEvents()` 的结果数组,而不是 `session.events` 属性,原因同 e1f26a4:Session 无 events 属性)。

- [ ] **Step 2: 移植快照过滤**

在 `saveEventSnapshots` 中加入上游 8419bc3 的三处过滤:`isDevicePath(absPath)` 跳过 `/dev|/proc|/sys`;`content === ''` 跳过空内容;bash 只读命令判写特征逻辑(在 resolveToolCallFiles 内,已随 Step 1 移植)。

- [ ] **Step 3: 接线**

approval/request handler 中 `parseReason` 之后:

```js
const toolFiles = resolveToolCallFiles(req.callId, session.snapshotEvents())
const filesOpt = toolFiles ? { files: toolFiles, baseDir: sessionCwd } : { baseDir: sessionCwd }
```

所有 `recordApprovalEvent`/`recordAutoAllow` 调用点追加 `...filesOpt`(与上游 12 处调用点对齐;在本仓库为 forwardToHuman 内 1 处 + recordAutoAllow 各调用点,统一在 forwardToHuman/recordAutoAllow 包装层传入)。

- [ ] **Step 4: 冒烟验证**

在 `test/pipeline.smoke.mjs` 场景 a(mock 宿主)追加断言:mock 的 tool/call 事件含 `arguments: {file_path: '<tmp>/a.js'}` 时,events.jsonl 中事件的 `files` 数组 == [该绝对路径](B 层命中)。

Run: `& 'C:\Users\LIULU\AppData\Local\hermes\node\node.exe' test\pipeline.smoke.mjs`
Expected: SMOKE PASS 全绿

- [ ] **Step 5: 提交**

```bash
git add src/index.mjs test/pipeline.smoke.mjs
git commit -m "feat: port upstream 0.5.2 diff-snapshot fixes (callId structured paths, read-only command filter)"
```

---

### Task 4: client.js 设置页回归(分级渲染)

**Files:**
- Modify: `client.js`(RulesSettings 恢复完整交互;死 CSS 复用)

**Interfaces:**
- Consumes: Task 2 的 GET/POST rules API 与 `permission` 元数据
- Produces: 设置页「自动审批」区块:管道总览(只读)、黑名单增删(add=确认框/remove 自定义=确认框/预置=按钮禁用)、白名单增删(danger-full-access 选项隐藏+提交后 403 提示兜底)、永久人工规则管理、学习进度展示(只读+清空按钮走本地命令提示)、阈值/超时编辑(free)、数据目录与模型显示(只读+文件指引)

- [ ] **Step 1: 恢复 RulesSettings(基于上游 0.5.0 的实现,套分级渲染)**

从上游 main client.js 复制 `RulesSettings` 全量(含 load/api/setupNow 反馈机制),然后做四处分级改造:

1. 渲染时读 GET 返回的 `permission` 元数据,`hardCategories` 卡片只渲染只读网格(无增删输入)
2. 预置项的删除按钮渲染为 `disabled` + title='预置项不可删除'(服务端也会 403,双保险)
3. 白名单表单不含 mode=danger-full-access 选项;若用户手输该值,提交后 403 的 `error` 原样展示在反馈条
4. 白名单添加按钮 onClick 包一层 `window.confirm('确认添加白名单规则?命中后将自动放行,不再人工确认。')`

阈值/超时输入保留 min/max 属性(1-20 / 5000-120000),与服务端校验一致;`feedback` 显示服务端返回的 error 原文。

- [ ] **Step 2: 模块 id 复查**

client.js 的 loader id 与 slot id 保持 `dsh-approval-core`(8c7b7be 已改,勿回退)。

- [ ] **Step 3: 语法与静态验证**

Run: `node --check client.js`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
git add client.js
git commit -m "feat: settings page with tiered permissions (read/free/confirm/forbidden)"
```

---

### Task 5: 版本号 + README + 全量回归

**Files:**
- Modify: `package.json`(version 0.2.0)
- Modify: `README.md`(v0.2.0 特性段:dataDir/classifierModel/配置 UI 分级说明/移植说明)

- [ ] **Step 1: package.json version → 0.2.0,scripts.test 补 config-rules**

```json
"scripts": {
  "test": "node --test",
  "check": "node --check src/index.mjs && node --check src/danger-patterns.mjs && node --check src/classifier.mjs && node --check src/learning.mjs && node --check src/configRules.mjs && node --check client.js"
}
```

- [ ] **Step 2: README 增补**

- 「配置 UI」段:四级权限表(🟢只读/🟡自由改/🟠确认改/🔴UI 禁改+服务端拒)
- 「数据目录」段:`allowlist.json` 加 `"dataDir": "D:\\data\\dsh-approval"` 后重启,learning/audit/events/snapshots 全部跟随;allowlist 本身留在原位;迁移旧数据=手动拷贝
- 「分类模型」段:`"classifierModel": {"provider":"...","model":"..."}` 优先于会话默认模型
- 「上游差异」表补:移植 0.5.2 两个 diff 修复;恢复受限配置 API(与上游差异:服务端四级校验,UI 只是体验层)

- [ ] **Step 3: 全量回归**

Run: 全部 5 个测试文件 + `npm run check`(或逐文件 --check)
Expected: 全绿(测试文件数 6:danger-patterns/classifier/learning/pipeline.test/config-rules + smoke)

- [ ] **Step 4: 提交**

```bash
git add package.json README.md
git commit -m "chore: v0.2.0 — config UI (tiered), dataDir, classifierModel, 0.5.2 ports"
```

---

### Task 6: 本地安装验证(需用户重启)

**Files:**
- 无代码改动;验证任务

- [ ] **Step 1: junction 已生效,无需重装;用户彻底重启 DSH Desktop**

- [ ] **Step 2: 真机冒烟清单**

1. 设置页「自动审批」区块出现完整管理 UI(非静态说明卡)
2. 修改确认阈值 5→3 → 保存 → `allowlist.json` 中 riskyThreshold 变 3 → 改回 5
3. 添加自定义黑名单词 `test-kw-xyz` → 弹确认框 → 生效 → 删除它
4. 尝试添加 `mode=danger-full-access` 白名单 → 反馈条显示服务端 403 reason
5. 硬风险类别卡片只读,无增删控件
6. `allowlist.json` 加 `"dataDir": "D:\\data\\dsh-approval"` → 重启 → 该目录出现 learning.json/events.jsonl;再触发一次自动放行,events 落新目录
7. `GET /api/auto-approve/rules` 返回含 `permission` 元数据与 `dataDir`

- [ ] **Step 3: 提交验证记录**

```bash
git add README.md
git commit -m "docs: v0.2.0 smoke-test results"
```

---

## Self-Review 记录

- **打包范围对照用户确认**:配置 UI 分级 ✅(Task 1/2/4)、0.5.2 移植 ✅(Task 3)、数据目录**可配置**而非强制迁 D 盘 ✅(Task 2 dataDir,用户纠正点)、模型可配 ✅(Task 2 Step 5)、死 CSS/precipitationRule 消重 → 死 CSS 随 Task 4 复用自然消化;precipitationRule 消重**未纳入**(纯内部整洁,不阻塞,留 v0.2.1);发布 GitHub+npm 未纳入(用户排序:先稳定)。
- **占位符**:无 TBD;Task 3 Step 1 引用上游函数为"原样复制已Fetch到本地的上游源码"——执行者从 spill 文件 `C:\Users\LIULU\AppData\Local\Temp\dsh-spill-Zh0AR7\session-ff33e578e383\d762698f313f-web_fetch.txt` 或重新 raw.githubusercontent 拉取,均含完整函数体。
- **类型一致性**:`classifyOp({op,kind,value,predefined,hardCategories})`/`validateValue({kind,value,op})`/`normalizeItem(item)` 在 Task 1→2 间签名一致;`filesOpt` 命名与上游一致。
