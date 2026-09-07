// pipeline.smoke.mjs — mock 宿主进程内冒烟：不起子进程、不起服务器，直接驱动 approval/request 管道。
// 覆盖 Task 5 评审要求的 4 个场景：
//   a. neutral ×5 人工确认 → 第 6 次同指纹自动放行（fp-hit，不再调 next）
//   b. learning.enabled=false → 同场景全部转人工（fp 命中也不放行）
//   c. flash 垃圾输出 → 解析失败重试 ×2 → fail-safe 转人工，next 恰好 1 次
//   d. 危险命令（reason 含 rm -rf /）→ DENY 层转人工，不调 flash 分类器
// 附加回归：修复前的 Critical 缺陷是 neutral 路径 ReferenceError(extractOperationFingerprint)
// 导致批准后 catch 回退再次调用 next()（同一审批重复递交）——本文件对每次调用断言 nextCalls，
// 人工确认路径必须恰好 1，自动放行路径必须 0。
//
// 用法：node test/pipeline.smoke.mjs   （任一断言失败 → 摘要 FAIL，exit 1）
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = join(here, '..', 'src')
const NEUTRAL_JUST = '更新 C:/Users/LIULU/Desktop/dsh-approval-core/README.md 文档内容'
const KEY = 'pwsh|danger-full-access|neutral'

const tmpRoot = mkdtempSync(join(tmpdir(), 'dsh-approval-smoke-'))
const homes = []
let mountSeq = 0
let passCount = 0
let failCount = 0

function check(scenario, label, cond, detail) {
  const ok = !!cond
  if (ok) passCount++; else failCount++
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${label}${detail !== undefined ? ' — ' + detail : ''}`)
}

function readJson(p) {
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

/** 挂载一个全新插件实例（独立 DSH_HOME + cache-bust 动态 import，模块顶层常量随之重新求值）。
 *  preWrite(home)：在 import 前预写文件（如带 dataDir 的 allowlist.json），用于测模块加载期配置解析。 */
async function mount(name, flashMode = 'neutral', preWrite = null) {
  const home = join(tmpRoot, name)
  homes.push(home)
  rmSync(home, { recursive: true, force: true })
  process.env.DSH_HOME = home
  if (preWrite) preWrite(home)
  const mod = await import(pathToFileURL(join(MODULE_DIR, 'index.mjs')).href + '?smoke=' + (++mountSeq))
  const handlers = {}
  let mode = flashMode
  let flashCalls = 0
  const flashText = () => {
    flashCalls++
    if (mode === 'garbage') return 'PROBABLY FINE I GUESS'
    if (mode === 'hard') return 'RISKY:DELETION'
    if (mode === 'safe') return 'SAFE'
    return 'RISKY:NEUTRAL'
  }
  const errors = []
  const realError = console.error
  console.error = (...a) => errors.push(a.map(String).join(' '))
  const host = { home, handlers, errors, command: null }
  try {
    mod.default.apply({
      llm: { stream: async function* () {
        yield { type: 'text-delta', text: flashText() }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } },
      permissionPresets: { current: () => 'auto-approve' },
      get: () => undefined,
      timeout: () => new Promise(() => {}),
      on: (ev, fn) => { handlers[ev] = fn },
      effect: () => {},
      inject: (svcs, cb) => { if (Array.isArray(svcs) && svcs.includes('commands')) cb({ commands: { register: (def) => { host.command = def } } }) },
    })
  } finally {
    console.error = realError
  }
  return {
    home,
    handlers,
    command: () => host.command,
    setFlash: (m) => { mode = m; flashCalls = 0 },
    flashCalls: () => flashCalls,
    drainErrors: () => errors.splice(0),
  }
}

const req = (just = NEUTRAL_JUST) => ({
  agent: { session: { id: 's-smoke', cwd: 'C:\\nonexistent-base', events: [] } },
  toolName: 'pwsh',
  reason: 'escalate sandbox to danger-full-access: ' + just,
  signal: null,
})

/** 跑一次审批：next 计数 + flash 增量 + 本次调用期间捕获的错误随返回值带走 */
async function callOnce(host, r, outcome = 'allowed-once') {
  let nextCalls = 0
  const next = async () => { nextCalls++; return outcome }
  const flash0 = host.flashCalls()
  const errs = []
  const realError = console.error
  console.error = (...a) => errs.push(a.map(String).join(' '))
  let result
  try {
    result = await host.handlers['approval/request'](r, next)
  } finally {
    console.error = realError
  }
  return { result, nextCalls, flashCalls: host.flashCalls() - flash0, errs }
}

const learningOf = (h) => readJson(join(h.home, 'auto-approve', 'learning.json'))
const allowlistOf = (h) => readJson(join(h.home, 'auto-approve', 'allowlist.json'))
const setLearningFlag = (h, enabled) => {
  const cfg = allowlistOf(h) || {}
  cfg.learning = { enabled }
  writeFileSync(join(h.home, 'auto-approve', 'allowlist.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}
const hasFpRefErr = (errs) => errs.some((e) => e.includes('extractOperationFingerprint'))

try {
  // ---- 场景 a：neutral ×5 人工确认 → 第 6 次同指纹自动放行 ----
  {
    const s = 'a-neutral-fp-hit'
    const h = await mount(s)
    if (h.handlers['approval/request']) {
      let allClean = true
      for (let i = 1; i <= 5; i++) {
        const r = await callOnce(h, req())
        const ok = r.result === 'allowed-once' && r.nextCalls === 1 && !hasFpRefErr(r.errs)
        if (!ok) allClean = false
        check(s, `第${i}次人工确认：next 恰好 1 次、无 ReferenceError（批准后不重复递交）`,
          ok, `result=${r.result} nextCalls=${r.nextCalls} fpRefErr=${hasFpRefErr(r.errs)} unexpectedErr=${r.errs.length}`)
      }
      const L = learningOf(h)
      const stat = L && L.stats && L.stats[KEY]
      check(s, '5 次确认后 stats=5', stat === 5, `stats=${JSON.stringify(stat)}`)
      const sample = L && L.history && L.history[KEY] && L.history[KEY][0]
      check(s, 'recordSample 落了指纹样本（原崩溃点之后代码可达）', !!sample && typeof sample.fp === 'string' && sample.fp.length > 0,
        `sample=${JSON.stringify(sample || null)}`)
      const r6 = await callOnce(h, req())
      check(s, '第6次同指纹：自动放行、next 0 次、flash 仅判定 1 次',
        r6.result === 'allowed-once' && r6.nextCalls === 0 && r6.flashCalls === 1 && !hasFpRefErr(r6.errs),
        `result=${r6.result} nextCalls=${r6.nextCalls} flashCalls=${r6.flashCalls} fpRefErr=${hasFpRefErr(r6.errs)}`)
      check(s, '场景 a 全程无意外错误输出', allClean && h.drainErrors().length === 0)
    } else {
      check(s, 'approval/request 处理器已挂载', false, 'handlers missing')
    }
  }

  // ---- 场景 b：learning.enabled=false → fp 命中也全部转人工 ----
  {
    const s = 'b-learning-disabled'
    const h = await mount(s)
    for (let i = 1; i <= 5; i++) await callOnce(h, req())   // 铺到阈值位
    setLearningFlag(h, false)
    const rOff = await callOnce(h, req())
    check(s, 'enabled=false：fp 命中仍转人工（next 1 次，不自动放行）',
      rOff.result === 'allowed-once' && rOff.nextCalls === 1 && !hasFpRefErr(rOff.errs),
      `nextCalls=${rOff.nextCalls} fpRefErr=${hasFpRefErr(rOff.errs)}`)
    const L = learningOf(h) || {}
    check(s, 'enabled=false：stats 不增长（学习放行关闭）', (L.stats || {})[KEY] === 5,
      `stats=${JSON.stringify((L.stats || {})[KEY])}`)
    setLearningFlag(h, true)
    const rOn = await callOnce(h, req())
    check(s, '重新 enabled=true：同指纹立即自动放行（next 0 次）',
      rOn.result === 'allowed-once' && rOn.nextCalls === 0 && !hasFpRefErr(rOn.errs),
      `nextCalls=${rOn.nextCalls} fpRefErr=${hasFpRefErr(rOn.errs)}`)
  }

  // ---- 场景 c：flash 垃圾输出 → fail-safe 转人工，next 恰好 1 次 ----
  {
    const s = 'c-flash-garbage'
    const h = await mount(s, 'garbage')
    const r = await callOnce(h, req())
    check(s, '垃圾输出：解析失败重试共 2 次 flash',
      r.flashCalls === 2, `flashCalls=${r.flashCalls}`)
    check(s, '垃圾输出：fail-safe 转人工，next 恰好 1 次（不自动放行）',
      r.result === 'allowed-once' && r.nextCalls === 1,
      `result=${r.result} nextCalls=${r.nextCalls}`)
    const parseErrs = r.errs.filter((e) => e.includes('flash 输出无法解析'))
    check(s, '错误输出仅为预期的 2 次解析失败日志，无 ReferenceError',
      parseErrs.length === 2 && !hasFpRefErr(r.errs) && r.errs.length === 2,
      `errs=${r.errs.length} parseErrs=${parseErrs.length} fpRefErr=${hasFpRefErr(r.errs)}`)
    const statsC = (learningOf(h) || {}).stats || {}
    check(s, 'fail-safe 不计数不沉淀', !(statsC[KEY] > 0), `stats=${JSON.stringify(statsC[KEY])}`)
  }

  // ---- 场景 d：危险命令（DENY 层最高优先）→ 人工且不调分类器 ----
  {
    const s = 'd-danger-deny'
    const h = await mount(s)
    const r = await callOnce(h, req('rm -rf / 清理临时目录'))
    check(s, 'reason 含 rm -rf /：转人工（next 1 次）',
      r.result === 'allowed-once' && r.nextCalls === 1,
      `result=${r.result} nextCalls=${r.nextCalls}`)
    check(s, 'DENY 层拦截：flash 分类器 0 次调用', r.flashCalls === 0, `flashCalls=${r.flashCalls}`)
    check(s, 'DENY 路径无任何错误输出', r.errs.length === 0 && !hasFpRefErr(r.errs), `errs=${r.errs.length}`)
    const Ld = learningOf(h) || {}
    check(s, '危险请求不产生学习记录', !Object.keys(Ld.stats || {}).length,
      `stats=${JSON.stringify(Ld.stats || {})}`)
  }

  // ---- 场景 e：dataDir 自定义目录（allowlist.json 预写 dataDir → events/snapshots/learning/audit 迁过去，allowlist 留默认目录） ----
  {
    const s = 'e-custom-datadir'
    const customDir = join(tmpRoot, s + '-custom-data')
    const h = await mount(s, 'neutral', (home) => {
      // 鸡生蛋问题：allowlist.json 永远在默认目录（它声明了 dataDir），故在 import 前预写
      const defaultData = join(home, 'auto-approve')
      mkdirSync(defaultData, { recursive: true })
      writeFileSync(join(defaultData, 'allowlist.json'),
        JSON.stringify({ version: 3, dataDir: customDir }, null, 2) + '\n', 'utf8')
    })
    if (h.handlers['approval/request']) {
      const r = await callOnce(h, req())
      check(s, 'dataDir 自定义：审批管道正常工作（next 1 次转人工）',
        r.result === 'allowed-once' && r.nextCalls === 1,
        `result=${r.result} nextCalls=${r.nextCalls}`)
      check(s, 'dataDir 自定义：events.jsonl 落在自定义目录', existsSync(join(customDir, 'events.jsonl')),
        `customDir events exists=${existsSync(join(customDir, 'events.jsonl'))}`)
      const evText = existsSync(join(customDir, 'events.jsonl')) ? readFileSync(join(customDir, 'events.jsonl'), 'utf8') : ''
      check(s, '自定义目录 events.jsonl 含本次审批事件（manual-pending）', evText.includes('manual-pending'))
      check(s, 'dataDir 自定义：learning.json 落在自定义目录（跟随 DATA_DIR）',
        existsSync(join(customDir, 'learning.json')) && !existsSync(join(h.home, 'auto-approve', 'learning.json')))
      check(s, 'dataDir 自定义：audit.log 落在自定义目录', existsSync(join(customDir, 'audit.log')))
      check(s, 'dataDir 自定义：allowlist.json 留在默认目录（声明者自身不迁移）',
        existsSync(join(h.home, 'auto-approve', 'allowlist.json')) && !existsSync(join(customDir, 'allowlist.json')))
      check(s, '默认目录无 events.jsonl 泄漏', !existsSync(join(h.home, 'auto-approve', 'events.jsonl')))
    } else {
      check(s, 'approval/request 处理器已挂载', false, 'handlers missing')
    }
  }
} finally {
  delete process.env.DSH_HOME
  for (const dir of homes) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
}

console.log('────────────────────────────────────────')
console.log(`SMOKE ${failCount === 0 ? 'PASS' : 'FAIL'}: ${passCount} passed, ${failCount} failed`)
if (failCount > 0) process.exitCode = 1
