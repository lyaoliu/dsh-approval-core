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
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
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

const req = (just = NEUTRAL_JUST, opts = {}) => ({
  agent: {
    session: {
      id: 's-smoke',
      cwd: opts.cwd !== undefined ? opts.cwd : 'C:\\nonexistent-base',
      // rc.1 的真实 Session 没有 events 属性，事件必须经 snapshotEvents() 获取（e1f26a4 教训）——mock 同样忠实建模
      snapshotEvents: () => (opts.sessionEvents || []),
    },
  },
  callId: opts.callId !== undefined ? opts.callId : null,
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
const dataDirOf = (h) => {
  const cfg = allowlistOf(h)
  return (cfg && typeof cfg.dataDir === 'string' && cfg.dataDir) ? cfg.dataDir : join(h.home, 'auto-approve')
}
const eventsJsonlOf = (h) => {
  const p = join(dataDirOf(h), 'events.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
const snapshotIdsOf = (h) => {
  const dir = join(dataDirOf(h), 'snapshots')
  if (!existsSync(dir)) return new Set()
  return new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')))
}
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

  // ---- 场景 f：callId 回溯 tool/call 事件 → 结构化真实路径进 events.jsonl（B 层命中） ----
  {
    const s = 'f-callid-structured-files'
    const h = await mount(s, 'hard') // RISKY:DELETION → 硬类别转人工（manual-pending 事件必落）
    if (h.handlers['approval/request']) {
      const workFile = join(tmpRoot, s + '-work.js')
      writeFileSync(workFile, 'const a = 1\n', 'utf8')
      const callId = 'call-f-1'
      const r = await callOnce(h, req('更新目标文件内容', {
        callId,
        sessionEvents: [
          { type: 'other/event', data: {} },
          { type: 'tool/call', data: { callId, arguments: JSON.stringify({ file_path: workFile, content: 'x' }) } },
        ],
      }))
      check(s, 'hard 类别转人工（manual-pending）',
        r.result === 'allowed-once' && r.nextCalls === 1, `result=${r.result} nextCalls=${r.nextCalls}`)
      const events = eventsJsonlOf(h)
      const pending = events.filter((e) => e.kind === 'manual-pending')
      check(s, 'events.jsonl 事件的 files == [结构化绝对路径]（callId 回溯 tool/call 命中，非 justification 提取）',
        pending.length > 0 && pending.every((e) => Array.isArray(e.files) && e.files.length === 1 && e.files[0] === workFile),
        `files=${JSON.stringify(pending.map((e) => e.files))}`)
      check(s, 'manual-pending 事件已存快照（事件 id 对应 snapshots/<id>.json）',
        pending.length > 0 && pending.every((e) => snapshotIdsOf(h).has(String(e.id))),
        `snapshotIds=${JSON.stringify([...snapshotIdsOf(h)])} evIds=${JSON.stringify(pending.map((e) => e.id))}`)
      const approved = events.filter((e) => e.kind === 'manual-approved')
      check(s, 'manual-approved 终态事件 files 与 pending 一致（filesOpt 贯穿 forwardToHuman 三处调用）',
        approved.length > 0 && approved.every((e) => Array.isArray(e.files) && e.files.length === 1 && e.files[0] === workFile),
        `files=${JSON.stringify(approved.map((e) => e.files))}`)
      check(s, 'manual-approved 事件带 snapshotEventId 且指向 pending 事件 id（diff/撤销按终态事件回退查快照）',
        approved.length > 0 && approved.every((e) => {
          const mine = pending.find((p) => p.tool === e.tool && p.ts <= e.ts && p.sessionId === e.sessionId)
          return e.snapshotEventId !== undefined && mine !== undefined && e.snapshotEventId === mine.id
        }),
        `approved=${JSON.stringify(approved.map((e) => ({ id: e.id, snapRef: e.snapshotEventId })))} pendingIds=${JSON.stringify(pending.map((e) => e.id))}`)
    } else {
      check(s, 'approval/request 处理器已挂载', false, 'handlers missing')
    }
  }

  // ---- 场景 g：bash 只读命令（ls <tmp>）→ 写特征判定不命中 → files 回退 justification 提取（C 层兜底） ----
  {
    const s = 'g-readonly-command-no-files'
    const h = await mount(s, 'hard')
    if (h.handlers['approval/request']) {
      const callId = 'call-g-1'
      const r = await callOnce(h, req('查看临时目录列表', {
        callId,
        sessionEvents: [
          { type: 'tool/call', data: { callId, arguments: JSON.stringify({ command: `ls ${tmpRoot}` }) } },
        ],
      }))
      check(s, 'hard 类别转人工（manual-pending）',
        r.result === 'allowed-once' && r.nextCalls === 1, `result=${r.result} nextCalls=${r.nextCalls}`)
      const events = eventsJsonlOf(h)
      const pending = events.filter((e) => e.kind === 'manual-pending')
      // 只读命令不提取路径：files 为空数组，或仅剩 justification 提取（回退）——绝不能出现命令里的 tmpRoot
      const leaked = pending.some((e) => Array.isArray(e.files) && e.files.some((f) => f === tmpRoot || f.startsWith(tmpRoot)))
      check(s, '只读命令场景：files 不含命令提取的路径（空或 justification 兜底，无假阳性）',
        pending.length > 0 && !leaked, `files=${JSON.stringify(pending.map((e) => e.files))}`)
    } else {
      check(s, 'approval/request 处理器已挂载', false, 'handlers missing')
    }
  }
  // ---- 场景 h：neutral 人工拒绝（rejected）→ 终态 manual-rejected 事件带 snapshotEventId（回退查 pending 快照） ----
  // 覆盖 neutral 学习路径两处 learned-removed 终态：
  //   ① stats 已达阈值、样本存在但指纹未命中且 flash 判不同类 → 人工 → 拒绝（index.mjs 第一处 rejected 分支）
  //   ② stats 未达阈值 → 人工 → 拒绝（index.mjs 第二处 rejected 分支）
  // 回归背景：approved 终态已带 snapshotEventId，rejected 终态此前遗漏 —— diff/撤销按终态事件回退查快照时拿不到快照引用。
  {
    const s = 'h-rejected-snapshot-event-id'
    const h = await mount(s)
    if (h.handlers['approval/request']) {
      // ① 阈值后拒绝：铺 5 次批准（stats=5 + 样本沉淀），再用不同理由拒绝
      //    （不同理由 → 指纹未命中 → flash 同类验证输出 DIFFERENT → 落人工；拒绝后升级永久人工规则）
      for (let i = 1; i <= 5; i++) await callOnce(h, req())
      const rej1 = await callOnce(h, req('清理另一个无关目录 C:/tmp/other/logs 下的过期文件'), 'rejected')
      check(s, '① 阈值后拒绝：rejected 透传、next 恰好 1 次',
        rej1.result === 'rejected' && rej1.nextCalls === 1,
        `result=${rej1.result} nextCalls=${rej1.nextCalls}`)
      let events = eventsJsonlOf(h)
      let pendings = events.filter((e) => e.kind === 'manual-pending')
      let rejects = events.filter((e) => e.kind === 'manual-rejected')
      check(s, '① manual-rejected 事件带 snapshotEventId 且指向本次 pending 事件 id',
        rejects.length === 1 && pendings.length === 6 && rejects[0].snapshotEventId !== undefined &&
        rejects[0].snapshotEventId === pendings[pendings.length - 1].id,
        `rejects=${JSON.stringify(rejects.map((e) => ({ id: e.id, snapRef: e.snapshotEventId, path: e.path })))} pendingIds=${JSON.stringify(pendings.map((e) => e.id))}`)
      check(s, '① 终态 path=learned-removed（neutral 学习路径标识）',
        rejects.length === 1 && rejects[0].path === 'learned-removed', `path=${rejects.length ? rejects[0].path : '(none)'}`)

      // ② 阈值前拒绝：新实例（无 denyRules 干扰），第一次就拒绝（stats=0 → 走前 N 次人工分支）
      const h2 = await mount(s + '-pre')
      const rej2 = await callOnce(h2, req(), 'rejected')
      check(s, '② 阈值前拒绝：rejected 透传、next 恰好 1 次',
        rej2.result === 'rejected' && rej2.nextCalls === 1,
        `result=${rej2.result} nextCalls=${rej2.nextCalls}`)
      events = eventsJsonlOf(h2)
      pendings = events.filter((e) => e.kind === 'manual-pending')
      rejects = events.filter((e) => e.kind === 'manual-rejected')
      check(s, '② manual-rejected 事件带 snapshotEventId 且指向本次 pending 事件 id',
        rejects.length === 1 && pendings.length === 1 && rejects[0].snapshotEventId !== undefined &&
        rejects[0].snapshotEventId === pendings[0].id,
        `rejects=${JSON.stringify(rejects.map((e) => ({ id: e.id, snapRef: e.snapshotEventId, path: e.path })))} pendingIds=${JSON.stringify(pendings.map((e) => e.id))}`)
      check(s, '② 终态 path=learned-removed（neutral 学习路径标识）',
        rejects.length === 1 && rejects[0].path === 'learned-removed', `path=${rejects.length ? rejects[0].path : '(none)'}`)
      // pending 事件 id 均有对应快照文件（快照按 pending 存，rejected 经 snapshotEventId 回退引用，无需自建快照）
      check(s, '② 全部 manual-pending 事件 id 均有快照文件（rejected 经 snapshotEventId 引用，不重复落快照）',
        pendings.every((e) => snapshotIdsOf(h2).has(String(e.id))),
        `snapshotIds=${JSON.stringify([...snapshotIdsOf(h2)])} evIds=${JSON.stringify(pendings.map((e) => e.id))}`)
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
