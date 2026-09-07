/**
 * dsh-approval-core — 自动审批（多级判定）持久插件 v3（fork 自 dsh-approval-gate）
 *
 * 挂在审批瀑布（approval/request）最前：当会话权限预设为 auto-approve 时，
 * 按「DENY → 白名单 → denyRules → flash（SAFE/硬类别/中立计数）→ 裁决学习」管道判定越界请求。
 *
 * 设计目标：最小人工介入。人工只出现在两类场景：
 *   1. 必须人工确认：DENY 危险词、硬风险类别（deletion/credential/remote/system/bulk）
 *   2. 中立操作（neutral）：前 N-1 次人工确认；阈值状态按「指纹命中 → flash 第三方同类验证 → 人工」分流：
 *      指纹命中（确认样本）→ 自动放行（学习沉淀只写 learning.json，不污染 allowRules 主表）
 *      指纹未命中但有样本 → flash 语义判断是否与确认样本同类（SAME 放行并沉淀指纹 / DIFFERENT 人工）
 *      无样本 / 判不同 / 验证失败 → 人工确认
 *      拒绝 → 升级为永久人工规则（denyRules）；取消 → 不计数
 *      学习可用 /approval-core-clear-learning 一键全撤
 *
 * DSH 审批触发点：命令在沙箱内被拒后，模型带 sandbox_permissions 重试，
 * 触发 approval.request，reason 固定为：
 *   `escalate sandbox to <mode>: <justification>`
 * 其中 mode 仅两级：workspace-write（写工作区，可回补）/
 * danger-full-access（任意文件/系统，危险）。
 *
 * flash 判定协议（v3，双协议解析统一走 classifier.mjs 的 parseVerdict）：
 *   严格 JSON {"verdict":"approve"|"ask"} 或 SAFE / RISKY:<category>
 *   category ∈ { deletion, credential, remote, system, bulk, neutral }
 *   硬类别（前五个）→ 直接转人工；neutral（中立）→ 计数放行，第 N 次转人工裁决。
 *
 * 超时/失败处理：AbortController + signal 传给 llm.stream（可取消），
 *   超时或失败重试 1 次，仍失败 → 转人工（fail-safe）。
 *
 * 数据文件（跨部署统一放到 DSH_HOME 下，node_modules 可能只读）：
 *   $DSH_HOME/auto-approve/allowlist.json  配置（denyKeywords/allowRules/denyRules/hardCategories/…）
 *   $DSH_HOME/auto-approve/learning.json   学习状态（跨会话持久化）
 *   $DSH_HOME/auto-approve/audit.log       审计（追加式）
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_DANGER_PATTERNS, compileDangerPatterns, findDangerMatch } from './danger-patterns.mjs'
import { parseVerdict } from './classifier.mjs'
import { DEFAULT_RISKY_THRESHOLD, shouldPrecipitate, clearLearning, extractOperationFingerprint } from './learning.mjs'
import { classifyOp, validateValue, normalizeItem } from './configRules.mjs'

const NAME = 'dsh-approval-core'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DEFAULT_DATA_DIR = join(DSH_HOME, 'auto-approve')
// dataDir 允许把快照/events/审计迁到任意盘（如 D:\data\dsh-approval）；
// allowlist.json 本身始终在 DEFAULT_DATA_DIR（它声明了 dataDir，鸡生蛋问题）
let DATA_DIR = DEFAULT_DATA_DIR
function resolveDataDir(cfg) {
  const custom = cfg && typeof cfg.dataDir === 'string' ? cfg.dataDir.trim() : ''
  if (!custom) return DEFAULT_DATA_DIR
  // 仅接受绝对路径；相对路径视为配置错误，回退默认（fail-safe）
  if (!/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(custom)) return DEFAULT_DATA_DIR
  return custom
}
const ALLOWLIST_PATH = join(DATA_DIR, 'allowlist.json')
// 以下路径基于 DATA_DIR，在读取 allowlist.json（resolveDataDir 所需）后重算为 let
let LEARNING_PATH = join(DATA_DIR, 'learning.json')
let AUDIT_PATH = join(DATA_DIR, 'audit.log')
let EVENTS_PATH = join(DATA_DIR, 'events.jsonl')
let SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots')
// 已执行撤销记录（持久态，防止重复投递）：reverts.jsonl，每行 {eventId, hunkKey, ts}
// hunkKey：整文件撤销='*', 块撤销=delLines+addLines 内容拼接的稳定指纹

// 快照限制：单文件 ≤256KB、每事件 ≤5 个文件
const SNAPSHOT_MAX_BYTES = 256 * 1024
const SNAPSHOT_MAX_FILES = 5

/** 判定文本文件（跳过二进制/图片等） */
const SNAPSHOT_BINARY_RE = /[\x00-\x08\x0e-\x1f]/
function isSnapshotText(buf) {
  if (buf.length > SNAPSHOT_MAX_BYTES) return false
  const head = buf.subarray(0, Math.min(buf.length, 8192))
  return !SNAPSHOT_BINARY_RE.test(head.toString('latin1'))
}

/** 读取文件快照（文本，限制大小）；失败返回 null */
function readSnapshotFile(absPath) {
  try {
    const buf = readFileSync(absPath)
    if (!isSnapshotText(buf)) return null
    return buf.toString('utf8')
  } catch { return null }
}

/** 快照目录安全包装：列目录 / 取大小 / 删除（失败不抛） */
function readdirSyncSafe(dir) {
  try { return readdirSync(dir) } catch { return [] }
}
function statSyncSafe(absPath) {
  try { return statSync(absPath).size } catch { return 0 }
}
function rmSyncSafe(absPath) {
  rmSync(absPath, { force: true })
}

/** 判断某个快照文件是否属于指定会话（读 JSON 的 sessionId 字段；无 sessionId 的旧快照视为不匹配，仅全量操作命中） */
function snapshotMatchesSession(absPath, sessionId) {
  if (!sessionId) return true
  try {
    const data = JSON.parse(readFileSync(absPath, 'utf8'))
    return String(data.sessionId || '') === String(sessionId)
  } catch { return false }
}

/** 解析文件路径为绝对路径（~ → home，/ 或盘符 → 原样，相对 → 依次尝试会话 cwd / 进程 cwd / home，取存在的） */
function resolveAbsPath(p, baseDir) {
  const s = String(p || '')
  if (s.startsWith('~')) return join(homedir(), s.slice(1))
  if (s.startsWith('/')) return s
  // Windows 盘符/UNC 绝对路径原样返回：join(baseDir, 'C:\\x') 会拼出非法路径（上游缺陷，本仓库修复）
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(s)) return s
  const candidates = [baseDir, process.cwd(), homedir()].filter((b) => typeof b === 'string' && b)
  const seen = new Set()
  for (const b of candidates) {
    const abs = join(b, s)
    if (!seen.has(abs)) {
      seen.add(abs)
      if (existsSync(abs)) return abs
    }
  }
  // 都不存在：返回第一个候选（快照保存时会因读不到而跳过，保持确定性）
  return join(candidates[0] || process.cwd(), s)
}

/** 判断是否为设备/伪文件路径（/dev/*、/proc/*、/sys/*）——不保存快照 */
function isDevicePath(absPath) {
  return /^\/dev\//.test(absPath) || /^\/proc\//.test(absPath) || /^\/sys\//.test(absPath)
}

/** 保存事件涉及文件的快照（审批时 = 改动前内容） */
function saveEventSnapshots(eventId, files, baseDir, sessionId) {
  const list = files || []
  if (list.length === 0) return
  const snapshots = []
  const seen = new Set()
  for (const f of list) {
    if (snapshots.length >= SNAPSHOT_MAX_FILES) break
    const abs = resolveAbsPath(f, baseDir)
    if (seen.has(abs)) continue
    seen.add(abs)
    // 设备/伪文件（/dev/null 等）不保存快照
    if (isDevicePath(abs)) continue
    const content = readSnapshotFile(abs)
    if (content === null) continue
    // 空内容快照无 diff 意义（空 vs 空 无行），跳过
    if (content === '') continue
    snapshots.push({ path: abs, content, ts: new Date().toISOString() })
  }
  if (snapshots.length === 0) return
  const cwdUsed = (typeof baseDir === 'string' && baseDir) ? baseDir : process.cwd()
  try {
    ensureDataDir()
    mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    writeFileSync(join(SNAPSHOTS_DIR, String(eventId) + '.json'), JSON.stringify({ eventId, sessionId: String(sessionId || ''), cwd: cwdUsed, snapshots }, null, 2), 'utf8')
  } catch (error) {
    console.error(`[${NAME}] 保存快照失败`, error)
  }
}

/** 读取事件快照 */
function loadEventSnapshots(eventId) {
  try {
    const raw = readFileSync(join(SNAPSHOTS_DIR, String(eventId) + '.json'), 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data.snapshots) ? data.snapshots : []
  } catch { return [] }
}

/** 读取事件快照（带回退）：approved 事件本身无快照文件（快照挂在其 pending 事件 id 下），
 *  直接查不到时扫描 events.jsonl 找该事件的 snapshotEventId 字段，用它再查一次。 */
function loadEventSnapshotsWithRef(eventId) {  const direct = loadEventSnapshots(eventId)
  if (direct.length > 0) return direct
  try {
    const text = readFileSync(EVENTS_PATH, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev && ev.id === eventId && ev.snapshotEventId !== undefined) {
          return loadEventSnapshots(ev.snapshotEventId)
        }
      } catch { /* 跳过坏行 */ }
    }
  } catch { /* events 文件不存在 */ }
  return []
}

/** 撤销键：整文件='*'；块=ev<事件>:h<块索引>:<del长度>:<add长度>
 *  ⚠️ 只含长度不含内容——内容会随文件变化漂移，导致"已撤销的块"在重开面板后重新可点。
 *  事件id+块索引+长度是稳定标识；文件漂移后（长度变化）视为新差异，允许重新投递。 */
export function hunkKeyOf(hasHunk, eventId, hunkIndex, delJoined, addJoined) {
  if (!hasHunk) return '*'
  const fp = String(delJoined || '').length + ':' + String(addJoined || '').length
  return 'ev' + eventId + ':h' + String(hunkIndex ?? '?') + ':' + fp
}

/** 该事件（该块）是否已执行过撤销；返回记录或 null */
function findRevertRecord(eventId, hunkKey) {
  const path = join(DATA_DIR, 'reverts.jsonl')
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        if (r && r.eventId === eventId && (hunkKey === '*' || r.hunkKey === '*' || r.hunkKey === hunkKey)) return r
      } catch { /* 跳过坏行 */ }
    }
  } catch { /* 文件不存在=未撤销过 */ }
  return null
}

/** 记录一次已执行撤销（追加式；失败不阻断主流程） */
function recordRevert(eventId, hunkKey) {
  try {
    ensureDataDir()
    appendFileSync(join(DATA_DIR, 'reverts.jsonl'),
      JSON.stringify({ eventId, hunkKey, ts: new Date().toISOString() }) + '\n', 'utf8')
  } catch { /* 记录失败不影响主流程 */ }
}

/** 逐行 diff：只返回变更行（add/del） */
function diffLines(before, after, contextLines) {
  const CTX = (typeof contextLines === 'number' && contextLines >= 0) ? contextLines : 5
  const a = String(before == null ? '' : before).split('\n')
  const b = String(after == null ? '' : after).split('\n')
  // 行级贪心匹配：b 中每个值的位置队列，a 按序匹配（保持顺序、近似 LCS）
  const bPos = new Map()
  for (let j = 0; j < b.length; j++) {
    if (!bPos.has(b[j])) bPos.set(b[j], [])
    bPos.get(b[j]).push(j)
  }
  const aMatch = new Array(a.length).fill(-1)
  const bUsed = new Array(b.length).fill(false)
  let limit = 0
  for (let i = 0; i < a.length; i++) {
    const q = bPos.get(a[i])
    if (!q) continue
    for (const pos of q) {
      if (pos >= limit && !bUsed[pos]) { aMatch[i] = pos; bUsed[pos] = true; limit = pos + 1; break }
    }
  }
  // 双指针生成位置交错的操作序列（same/del/add），保留原/新行号
  const ops = [] // {type:'same'|'del'|'add', aNo?, bNo?, text}
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && aMatch[i] >= 0) {
      const target = aMatch[i]
      while (j < target) { ops.push({ type: 'add', bNo: j + 1, text: b[j] }); j++ }
      ops.push({ type: 'same', aNo: i + 1, bNo: target + 1, text: a[i] })
      j = target + 1
      i++
    } else if (i < a.length) {
      ops.push({ type: 'del', aNo: i + 1, text: a[i] })
      i++
    } else {
      ops.push({ type: 'add', bNo: j + 1, text: b[j] })
      j++
    }
  }
  // 标记展示行：变更行 ±CTX 的 same 行作为上下文
  const show = new Array(ops.length).fill(false)
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type === 'same') continue
    for (let k = Math.max(0, idx - CTX); k <= Math.min(ops.length - 1, idx + CTX); k++) show[k] = true
  }
  // 聚类 hunk：连续展示行成块，块间隐藏行数记为 hiddenBefore（首块为 0，无参照前置）
  const hunks = []
  let hiddenBefore = 0
  let pending = []
  let started = false
  for (let idx = 0; idx < ops.length; idx++) {
    if (show[idx]) {
      started = true
      pending.push(ops[idx])
    } else {
      if (started && pending.length) {
        hunks.push({ hiddenBefore, lines: pending })
        pending = []
        started = false
      }
      hiddenBefore++
    }
  }
  if (pending.length && started) hunks.push({ hiddenBefore, lines: pending })
  if (hunks.length > 0) hunks[0].hiddenBefore = 0
  const added = ops.filter((o) => o.type === 'add').length
  const removed = ops.filter((o) => o.type === 'del').length
  const stats = {
    added,
    removed,
    contextLines: Math.max(a.length, b.length) - (added + removed),
  }
  return {
    hunks: hunks.map((h) => ({ hiddenBefore: h.hiddenBefore, lines: h.lines })),
    stats,
    changedLines: ops.filter((o) => o.type !== 'same').slice(0, 500),
  }
}

/** 反向应用一个 hunk（纯函数，不写文件）：把该块的变更倒回去。
 *  输入：hunk.lines（op 序列，行带 aNo/bNo 行号）。
 *  输出：{ targetText, aStart, aEnd, bStart, bEnd } —— targetText 是"撤销后该块应有的完整文本"，
 *  aStart-aEnd 是该块在改动前文件(a 侧)的行号范围，bStart-bEnd 是在当前文件(b 侧)的行号范围。
 *  AI 侧语义：用 targetText 整体替换当前文件的第 bStart-bEnd 行；若行号/内容对不上，以锚点定位，定位失败先说明不执行。
 */
export function reverseHunk(lines) {
  const list = Array.isArray(lines) ? lines : []
  const target = []
  let aStart = null, aEnd = null, bStart = null, bEnd = null
  for (const l of list) {
    if (!l || typeof l.text !== 'string') continue
    if (l.type === 'del' || l.type === 'same') {
      // del=改动前存在→撤销后恢复；same=上下文→原样保留
      target.push(l.text)
      if (typeof l.aNo === 'number') {
        if (aStart === null) aStart = l.aNo
        aEnd = l.aNo
      }
    }
    // add=改动新增→撤销时删掉（不进 target）
    if (typeof l.bNo === 'number') {
      if (bStart === null) bStart = l.bNo
      bEnd = l.bNo
    }
  }
  return { targetText: target.join('\n'), aStart, aEnd, bStart, bEnd }
}

// 自动放行事件序号（进程内递增，重启后从现有文件恢复，避免与历史重复）；
// 恢复扫描在 DATA_DIR 解析（依赖 allowlist.json 的 dataDir）之后执行，见 reloadConfig 定义前的 initPaths()
let eventSeq = 0

/** 从 justification 提取涉及的文件/路径（供审查界面展示） */
function extractFiles(text) {
  const s = String(text || '')
  const found = []
  const seen = new Set()
  const add = (v) => {
    const seg = v.replace(/[，。；、,.;:：\s]+$/g, '').trim()
    if (seg.length < 3 || seg.length > 120) return
    // 按文件名（basename）去重：同一文件的绝对/相对/裸名只保留最先出现的完整形式（快照解析用）
    const base = String(seg).split('/').pop()
    if (!base || base.length < 2) return
    if (seen.has(base)) return
    seen.add(base)
    found.push(seg)
  }
  for (const m of s.matchAll(/(?:~\/|\/|\.\/)?[\w@.-]+\/[\w@.\/-]+/g)) add(m[0])
  for (const m of s.matchAll(/[\w@.-]+\.(?:md|js|json|ya?ml|env|txt|py|ts|css|html|log|mjs|cjs)/gi)) add(m[0])
  return found.slice(0, 8)
}

/**
 * 从 approval/request 的 callId 回溯会话日志中的 tool/call 事件，取结构化参数里的真实路径。
 * B 层：edit/write/select 等带 file_path 字段的工具 → 解析 arguments JSON 拿确凿路径；
 * bash/exec 等带 command 字段的工具 → 从命令文本提取路径。
 * 未命中（无 callId / 事件缺失 / 参数解析失败）返回 null，调用方回退 justification 提取（C 层兜底）。
 * @param {string|null|undefined} callId approval 请求关联的工具调用 ID
 * @param {Array} events 会话事件列表（session.events）
 * @returns {string[]|null} 结构化路径数组（未命中返回 null）
 */
function resolveToolCallFiles(callId, events) {
  if (!callId || !Array.isArray(events) || events.length === 0) return null
  let args = null
  for (const ev of events) {
    if (ev && ev.type === 'tool/call' && ev.data && ev.data.callId === callId) {
      const raw = ev.data.arguments
      try { args = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { args = null }
      break
    }
  }
  if (!args || typeof args !== 'object') return null
  const found = []
  const seen = new Set()
  const addPath = (v) => {
    if (typeof v !== 'string') return
    const seg = v.trim()
    if (seg.length < 3 || seg.length > 1024) return
    if (/^(https?:|data:|blob:)/i.test(seg)) return
    if (!seg.includes('/') && !seg.includes('\\')) return
    if (seen.has(seg)) return
    seen.add(seg)
    found.push(seg)
  }
  // 1) 显式文件字段（edit/write/read/select/patch 等）
  for (const k of ['file_path', 'filePath', 'path', 'filename', 'file', 'target', 'source', 'dest', 'destination']) {
    const v = args[k]
    if (Array.isArray(v)) v.forEach(addPath)
    else addPath(v)
    if (found.length >= 8) break
  }
  // 2) bash/exec/run 等命令类：仅在命令含「写目标」时提取路径（读命令如 tail/ls/cat/grep 不产生文件改动，提取=假阳性）
  if (found.length === 0 && (args.command || args.cmd || args.script)) {
    const cmd = String(args.command || args.cmd || args.script || '')
    // 剥离 stderr 抑制片段（2>/dev/null、2>&1 是读命令的常见写法，不代表写文件）
    const cmdClean = cmd.replace(/2>>?\/dev\/null/g, ' ').replace(/2>&1/g, ' ')
    // 写操作特征：写类命令词 / stdout 重定向 / 包管理器安装 / sed|perl -i / curl|wget 落盘
    // （echo/printf 不在此列：纯输出不落盘，写文件场景由重定向正则覆盖，如 `echo x > file`）
    const hasWrite = /(^|[;&|]\s*)(touch|cp|mv|rm|tee|mkdir|rmdir|install|dd|truncate|shred|chmod|chown|chgrp)\b/i.test(cmdClean)
      || /(^|[;&|]\s*)(sed|perl|python|node|ruby)\b[^;|]*\s-i\b/i.test(cmdClean)
      || /(^|[;&|]\s*)(curl|wget)\b[^;|]*\s(-o|--output|-O)\b/i.test(cmdClean)
      || /(^|[;&|]\s*)(npm|pnpm|yarn|pip|pip3|gem|go|brew)\b[^;|]*\s(install|add|update|remove|uninstall)\b/i.test(cmdClean)
      || />>?|&>/.test(cmdClean.replace(/[^<>=]/g, '').replace(/<<+/g, ''))
    if (!hasWrite) return null
    // 提取命令中出现的路径（写命令的参数 + 重定向目标；/dev/* 等设备由快照层过滤）
    for (const f of extractFiles(cmd)) {
      addPath(f)
      if (found.length >= 8) break
    }
  }
  return found.length > 0 ? found : null
}

/**
 * 记录一次审批事件（结构化，供 client 审查界面轮询展示）。
 * kind: 'auto'（自动放行）/ 'manual-pending'（转人工等待）/ 'manual-approved'（人工通过）/
 *       'manual-rejected'（人工拒绝）
 * learningCount/threshold：人工通过时的学习进度（n/threshold，默认阈值 5）
 */
function recordApprovalEvent(sessionId, toolName, mode, reason, justification, verdict, opts) {
  eventSeq += 1
  const o = opts || {}
  const ev = {
    id: eventSeq,
    ts: new Date().toISOString(),
    sessionId: String(sessionId || ''),
    tool: String(toolName || 'unknown'),
    mode: String(mode || ''),
    reason: String(reason || '').slice(0, 600),
    justification: String(justification || '').slice(0, 400),
    verdict: String(verdict || 'auto'),
    files: Array.isArray(o.files) && o.files.length > 0 ? o.files : extractFiles(justification)
  }
  if (o.kind) ev.kind = o.kind
  if (o.learningCount !== undefined) ev.learningCount = o.learningCount
  if (o.threshold !== undefined) ev.threshold = o.threshold
  if (o.category) ev.category = o.category
  // path：判定路径标识（deny / deny-rule / hard-category / unknown-category / flash-failed /
  //       neutral-confirm / auto-learned（学习自动放行：fp-hit 或 flash 同类）/ human-approved / learned-removed）
  if (o.path) ev.path = o.path
  // snapshotEventId：终态事件（approved 等）指向其 pending 事件的 id——快照文件挂在 pending 事件 id 下，
  // 用户在批准后的终态事件上点文件 chip 时，diff 端点据此回退查 pending 的快照
  if (o.snapshotEventId !== undefined) ev.snapshotEventId = o.snapshotEventId
  try {
    ensureDataDir()
    appendFileSync(EVENTS_PATH, JSON.stringify(ev) + '\n', 'utf8')
    // 自动放行或转人工（pending，文件尚未改动）且涉及文件 → 保存改动前快照
    if ((ev.kind === 'auto' || ev.kind === 'manual-pending') && ev.files && ev.files.length > 0) {
      saveEventSnapshots(ev.id, ev.files, (o && o.baseDir) || null, sessionId)
    }
  } catch (error) {
    console.error(`[${NAME}] 记录审批事件失败`, error)
  }
  return ev
}

/** 兼容旧调用：记录自动放行事件（opts 透传给 recordApprovalEvent） */
function recordAutoAllow(sessionId, toolName, mode, reason, justification, verdict, opts) {
  return recordApprovalEvent(sessionId, toolName, mode, reason, justification, verdict, Object.assign({ kind: 'auto' }, opts || {}))
}

// 不可逆危险操作（deny 层，命中即转人工，优先级最高）
const DEFAULT_DENY_KEYWORDS = [
  'rm -rf', 'rm -fr', 'rm -r -f', 'rm --recursive --force',
  'push --force', 'force-push', 'force push', 'drop table', 'drop database',
  'mkfs', 'mkfs.ext', 'format', 'shutdown', 'reboot', 'dd of=',
  'delete from', 'truncate table', 'truncate ', 'terraform destroy', 'revoke',
  '清空数据库', '删除数据库', '格式化', 'sudo rm', 'chmod 777 /',
  'git reset --hard', 'git clean -fd', 'docker rm', 'docker system prune'
]

// 默认白名单规则：工作区写入（可回补）自动放行
const DEFAULT_ALLOW_RULES = [
  { mode: 'workspace-write', description: '工作区写入（可回补，对应 acceptEdits/workspace-write）' }
]

// 硬风险类别：flash 判 RISKY 且命中这些类别 → 直接转人工（不计数、不学习、永远人工）
const DEFAULT_HARD_CATEGORIES = ['deletion', 'credential', 'remote', 'system', 'bulk']

// v1 安全加固：不提供任何 HTTP 规则修改入口。规则/阈值/超时/学习开关一律直接编辑
// $DSH_HOME/auto-approve/allowlist.json 后生效（reloadConfig 每次审批前热读盘）；
// 危险清单（正则层）在模块加载时编译，denyKeywords 变更需重启生效。

/** 读取请求体 JSON（revert / snapshots-clear 的 POST 处理使用） */
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > limit) { req.destroy(new Error('payload too large')); reject(new Error('payload too large')) }
    })
    req.on('error', (err) => reject(err))
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch (e) { reject(e) }
    })
  })
}

const SYSTEM_PROMPT = [
  '你是 AI 编程代理的操作风险评估器。DSH 的审批只发生在「沙箱越界」时，即命令需要比当前更宽的权限才能执行。',
  '',
  '你将收到：工具名、请求升级的目标沙箱模式、以及一句操作理由（justification）。',
  '沙箱模式含义：',
  '- workspace-write：允许写当前工作区（可回补，通常安全）',
  '- danger-full-access：允许写任意文件/系统（不可回补风险高）',
  '',
  '输出规则（只输出一个词，SAFE 或 RISKY:<类别>）：',
  '- SAFE：操作不会造成不可回补后果，且不触碰敏感资源。例如：',
  '   工作区内常规读写、安装/构建、git 常规操作、可再生的临时数据、可撤销的修改、',
  '   个人目录（home）下的配置/项目文件常规编辑（可回补）',
  '- RISKY:<类别>：操作可能造成不可回补后果或触碰敏感资源，类别必须是以下之一：',
  '   deletion —— 删除/覆盖不可再生数据、rm 类危险删除',
  '   credential —— 修改/写入凭据、密钥、token、API key、授权配置',
  '   remote —— 影响远程系统/生产环境/数据库、发送消息/扣费、对外发布',
  '   system —— 系统级路径（/etc、/usr、启动项）、系统配置、shutdown/重启类',
  '   bulk —— 批量覆盖大量文件、格式化、dd 类不可回补操作',
  '   neutral —— 以上都不符合（如：工作区外普通文件的常规编辑、模型不确定但无明显硬风险）',
  '',
  '判定原则：',
  '- 只根据 justification 描述判断，不臆测额外风险',
  '- 可回补、常规、不触碰敏感资源的操作 → SAFE',
  '- 工作区外写入（如 ~/.dsh、个人项目仓库）本身不构成硬风险：判断的是操作内容，不是路径位置',
  '- 拿不准、但无删除/凭据/远程/系统/批量特征的 → neutral（这是误判补偿区，系统会计数后请用户裁决）',
  '',
  '只输出一个词：SAFE 或 RISKY:<类别>。不要输出任何其他内容。'
].join('\n')

function ensureDataDir() {
  try { mkdirSync(DATA_DIR, { recursive: true }) } catch { /* 目录创建失败不影响主流程 */ }
}

function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`[${NAME}] 读取 ${path} 失败，用默认值`, error)
    return fallback
  }
}

function saveJson(path, data) {
  try {
    // dataDir 是启动期字段（声明数据目录位置，鸡生蛋问题：allowlist 自身必须在默认目录），
    // 内存 config 经过 reload 往返可能丢失它——写 allowlist 前以磁盘文件为该字段的唯一权威合并回。
    if (path === ALLOWLIST_PATH && data && typeof data === 'object' && data.dataDir === undefined) {
      try {
        const disk = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
        if (disk && typeof disk.dataDir === 'string') data.dataDir = disk.dataDir
      } catch { /* 磁盘文件不可读：按无 dataDir 处理 */ }
    }
    ensureDataDir()
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (error) {
    console.error(`[${NAME}] 写入 ${path} 失败`, error)
  }
}

function audit(line) {
  try {
    ensureDataDir()
    appendFileSync(AUDIT_PATH, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch { /* 审计失败不影响主流程 */ }
}

// 首次加载时初始化配置文件；旧版（v1）自动补齐 v3 字段
function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  cfg.denyKeywords = cfg.denyKeywords || DEFAULT_DENY_KEYWORDS
  cfg.allowRules = cfg.allowRules || DEFAULT_ALLOW_RULES
  cfg.denyRules = cfg.denyRules || []
  cfg.hardCategories = cfg.hardCategories || DEFAULT_HARD_CATEGORIES
  cfg.riskyThreshold = cfg.riskyThreshold || DEFAULT_RISKY_THRESHOLD
  cfg.judgeTimeoutMs = cfg.judgeTimeoutMs || 20000
  cfg.learning = cfg.learning || { enabled: true }
  cfg.classifierModel = cfg.classifierModel || null
  return cfg
}

let config = loadJson(ALLOWLIST_PATH, null)
if (!config || typeof config !== 'object') {
  config = {
    version: 3,
    denyKeywords: DEFAULT_DENY_KEYWORDS,
    allowRules: DEFAULT_ALLOW_RULES,
    denyRules: [],
    hardCategories: DEFAULT_HARD_CATEGORIES,
    riskyThreshold: DEFAULT_RISKY_THRESHOLD,
    judgeTimeoutMs: 20000,
    learning: { enabled: true }
  }
  saveJson(ALLOWLIST_PATH, config)
} else {
  config = normalizeConfig(config)
  if (config.version !== 3) { config.version = 3; saveJson(ALLOWLIST_PATH, config) }
}

// dataDir 解析：allowlist.json（始终在默认目录）声明了自定义数据目录 → 全部运行时路径随之重算
DATA_DIR = resolveDataDir(config)
LEARNING_PATH = join(DATA_DIR, 'learning.json')
AUDIT_PATH = join(DATA_DIR, 'audit.log')
EVENTS_PATH = join(DATA_DIR, 'events.jsonl')
SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots')

// 事件序号恢复扫描：依赖最终 EVENTS_PATH，必须在 DATA_DIR 解析后执行
try {
  const existing = readFileSync(EVENTS_PATH, 'utf8')
  for (const line of existing.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      if (Number.isInteger(ev.id) && ev.id > eventSeq) eventSeq = ev.id
    } catch { /* 跳过坏行 */ }
  }
} catch { /* 文件不存在：从 0 开始 */ }

// 热更新：每次审批前重新读盘 allowlist.json（小文件、审批频率低，无性能问题），
// 使手动修改配置无需重启即可生效
function reloadConfig() {
  const disk = loadJson(ALLOWLIST_PATH, null)
  if (disk && typeof disk === 'object') {
    const prev = config
    config = normalizeConfig(disk)
    if (!config.version) config.version = prev.version || 3
    learning.enabled = config.learning.enabled !== false
  }
}

const learning = loadJson(LEARNING_PATH, { enabled: true, stats: {}, history: {} })
// enabled 以 allowlist.json 的 learning 段为单一配置源（旧 learning.json 的 enabled 仅作兼容回退）
learning.enabled = config.learning ? config.learning.enabled !== false : learning.enabled !== false
learning.stats = learning.stats || {}
// history：每个 key 最近人工确认过的操作样本（最多 10 个）：
//   { fp: 操作指纹（路径/文件名/项目名，可空）, ctx: 操作背景和目的（justification 摘要） }
// 供「flash 第三方同类验证」判断新操作是否与已确认样本同类。
// 兼容旧格式：字符串数组 → { fp, ctx } 对象数组
learning.history = learning.history || {}
for (const k of Object.keys(learning.history)) {
  if (!Array.isArray(learning.history[k])) learning.history[k] = []
  learning.history[k] = learning.history[k]
    .map((s) => typeof s === 'string' ? { fp: s, ctx: s } : s)
    .filter((s) => s && typeof s === 'object')
    .slice(-10)
}

// 正则危险清单(确定性,先于一切)+ 关键词 denyKeywords 作为可配第二层。
// 清单在模块加载时编译一次;reloadConfig() 热更新后不重建——denyKeywords 变更需重启生效(v1 明确"改文件生效")。
const dangerPatterns = compileDangerPatterns([
  ...DEFAULT_DANGER_PATTERNS,
  ...(config.denyKeywords || []).map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
])

function looksDeny(text) {
  return findDangerMatch(String(text || ''), dangerPatterns) !== undefined
}

// reason 格式：`escalate sandbox to <mode>: <justification>`
function parseReason(reason) {
  const m = String(reason || '').match(/escalate\s+sandbox\s+to\s+([^\s:]+):?\s*([\s\S]*)/i)
  if (m) return { mode: m[1], justification: (m[2] || '').trim() }
  return { mode: '', justification: String(reason || '') }
}

// 复用原 RISKY:<category> 协议提取类别;提取失败给 'neutral'(仅在 parseVerdict 判 risky 后调用)
function extractCategory(text) {
  const m = String(text || '').toUpperCase().match(/RISKY\s*[:：]\s*([A-Z_]+)/)
  return m ? m[1].toLowerCase() : 'neutral'
}

// 规则匹配：tool / mode / category / contains 均满足（缺省表示任意）
function matchRule(rules, toolName, mode, category, justification) {
  const list = rules || []
  const j = String(justification || '').toLowerCase()
  for (const rule of list) {
    if (rule.tool && rule.tool !== toolName) continue
    if (rule.mode && rule.mode !== mode) continue
    if (rule.category && rule.category !== category) continue
    if (rule.contains && !j.includes(String(rule.contains).toLowerCase())) continue
    return rule
  }
  return null
}

// 计数/学习 key：tool|mode|category（category 为 flash 判定的类别，neutral 走计数）
function learnKey(toolName, mode, category) {
  return `${toolName}|${mode || 'none'}|${category || 'none'}`
}

// 操作指纹提取统一走 learning.mjs 的 extractOperationFingerprint（Task 4 纯模块，单测覆盖），
// 避免双实现漂移。沉淀/拒绝规则必须携带指纹，避免宽规则误放行用户未确认过的操作。

export default {
  name: NAME,
  inject: ['llm', 'approval', 'permissionPresets', 'agentDefaultModel', 'timer', 'webServer'],
  apply(ctx) {
    const llm = ctx.llm
    const permissionPresets = ctx.permissionPresets
    const agentDefaultModel = ctx.get('agentDefaultModel')
    const PRESET_NAME = 'auto-approve'

    // ---- 自动放行事件 API（client 审查界面轮询；按会话过滤 + since 增量） ----
    let offEventsRoute = null
    try {
      if (ctx.webServer && typeof ctx.webServer.register === 'function') {
        offEventsRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/events',
          handler: async (req, res) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
            const url = new URL(req.url, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId') || ''
            const since = Number.parseInt(url.searchParams.get('since') || '0', 10) || 0
            const events = []
            try {
              const text = readFileSync(EVENTS_PATH, 'utf8')
              for (const line of text.split('\n')) {
                if (!line.trim()) continue
                try {
                  const ev = JSON.parse(line)
                  if (!Number.isInteger(ev.id) || ev.id <= since) continue
                  if (sessionId && ev.sessionId !== sessionId) continue
                  events.push(ev)
                } catch { /* 跳过坏行 */ }
              }
            } catch { /* events 文件不存在：返回空 */ }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
            res.end(JSON.stringify({ events }))
          },
        })
        console.log(`[${NAME}] 事件 API 已注册：/api/auto-approve/events`)
      } else {
        console.warn(`[${NAME}] webServer 不可用，审查事件 API 未注册`)
      }
    } catch (error) {
      console.error(`[${NAME}] 注册事件 API 失败`, error)
    }

    // ---- 配置读写 API（v0.2.0 恢复受限版：GET 只读 / POST 分级校验） ----
    // 写操作全部经 src/configRules.mjs 的 classifyOp（四级权限矩阵）+ validateValue（结构与范围）双重校验；
    // 硬类别与 classifierModel 不可经 UI 修改（安全边界，编辑文件生效）。
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
            // 先做结构与范围校验（不依赖权限判定，纯函数、无副作用），失败即 400
            const check = validateValue({ kind, value, op })
            if (!check.ok) return send(400, { ok: false, error: check.error })
            // Task 1 评审兜底（Minor-1）：剔除预置 allowRules 中 normalizeItem 后为空对象的畸形条目，
            // 避免其参与预置匹配；normalizeItem 复用 configRules.mjs 导出（勿内联重写）
            const sanitizedPredefined = {}
            for (const key of ['denyKeywords', 'allowRules', 'hardCategories']) {
              const list = key === 'allowRules' ? DEFAULT_ALLOW_RULES : (key === 'denyKeywords' ? DEFAULT_DENY_KEYWORDS : DEFAULT_HARD_CATEGORIES)
              sanitizedPredefined[key] = Array.isArray(list)
                ? list.filter((item) => { const n = normalizeItem(item); return !(n && typeof n === 'object' && Object.keys(n).length === 0) })
                : undefined
            }
            const verdict = classifyOp({ op, kind, value, predefined: sanitizedPredefined, hardCategories: config.hardCategories })
            if (verdict.level === 'forbidden') {
              audit(`CFG-DENY ${kind} op=${op} | ${verdict.reason}`)
              return send(403, { ok: false, error: verdict.reason })
            }
            reloadConfig()
            if (kind === 'riskyThreshold' || kind === 'judgeTimeoutMs') {
              config[kind] = check.normalized
              saveJson(ALLOWLIST_PATH, config)
              audit(`CONFIG  ${kind} → ${check.normalized}`)
              return send(200, { ok: true, set: true, value: check.normalized })
            }
            // dataDir（confirm 级，启动期字段）：写回 allowlist.json，重启后 initPaths 重算运行时目录。
            // 注：saveJson 的 dataDir 保留逻辑仅在 data.dataDir===undefined 时从磁盘合并，此处内存值已是新值，会原样落盘。
            if (kind === 'dataDir') {
              config.dataDir = check.normalized
              saveJson(ALLOWLIST_PATH, config)
              audit(`CONFIG  dataDir → ${check.normalized}（重启生效）`)
              return send(200, { ok: true, needRestart: true, value: check.normalized })
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

    // ---- diff / 撤销 / 快照管理 API ----
    let offDiffRoute = null
    let offRevertRoute = null
    let offSnapStatsRoute = null
    let offSnapClearRoute = null

    /** 投递消息到会话（撤销指令）；复用 workspace-panels 的 chatSend 机制 */
    const sendToSession = async (sessionId, content) => {
      // DSH 用户消息 content 必须是块数组；裸字符串会被 GUI 渲染器按字符迭代，
      // 每个字符渲染成一个「附加内容块」占位符，导致对话界面错乱（v0.5.0 事故根因）。
      const textBlock = [{ type: 'text', text: content }]
      const typertGateway = ctx.get('typertGateway')
      if (typertGateway && typeof typertGateway.invoke === 'function') {
        try {
          await typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { sessionId, mode: 'queue', content: textBlock } })
          return { ok: true, via: 'gateway' }
        } catch (e) {
          console.log(`[${NAME}] gateway 投递失败，改用 followup：${(e && e.message) || e}`)
        }
      }
      const agents = ctx.get('agents')
      if (agents && typeof agents.get === 'function') {
        const agent = agents.get(sessionId)
        if (agent && typeof agent.followup === 'function') {
          agent.followup({
            id: 'ag-revert-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
            role: 'user',
            content: textBlock,
            source: { kind: 'user' },
          })
          return { ok: true, via: 'followup' }
        }
      }
      return { ok: false, error: '没有可用的消息投递通道' }
    }

    try {
      if (ctx.webServer && typeof ctx.webServer.register === 'function') {
        const send = (res, code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify(obj))
        }

        offDiffRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/diff',
          handler: async (req, res) => {
            try {
              if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'method not allowed' })
              const url = new URL(req.url, 'http://localhost')
              const eventId = Number.parseInt(url.searchParams.get('eventId') || '', 10)
              const path = url.searchParams.get('path') || ''
              if (!Number.isInteger(eventId) || !path) return send(res, 400, { ok: false, error: 'eventId/path 必填' })
              // 快照回退：eventId 直接无快照时（如 approved 终态事件），按其 snapshotEventId 指向的 pending 事件查
              const snaps = loadEventSnapshotsWithRef(eventId)
              // client 传的是 justification 中的原始路径（可能绝对/相对/裸文件名），多基准对齐快照的绝对路径
              const base = resolveAbsPath(path)
              const baseName = String(path).split('/').pop()
              const snap = snaps.find((s) => s.path === base || s.path === path)
                || snaps.find((s) => s.path.endsWith('/' + path) || (baseName && s.path.endsWith('/' + baseName)))
              if (!snap) return send(res, 404, { ok: false, error: '该事件没有此文件的快照' })
              const before = snap.content
              const after = readSnapshotFile(snap.path)
              const result = diffLines(before, after == null ? null : after)
              send(res, 200, {
                ok: true,
                path,
                eventId,
                beforeExists: before != null,
                afterExists: after != null,
                changedLines: result.changedLines,
                hunks: result.hunks || [],
                stats: result.stats,
              })
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        offRevertRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/revert',
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
              const body = await readBody(req)
              const sessionId = String(body.sessionId || '')
              const eventId = Number.parseInt(String(body.eventId || ''), 10)
              if (!sessionId || !Number.isInteger(eventId)) return send(res, 400, { ok: false, error: 'sessionId/eventId 必填' })
              // 读取事件信息组装撤销指令
              const event = (() => {
                try {
                  const text = readFileSync(EVENTS_PATH, 'utf8')
                  for (const line of text.split('\n')) {
                    if (!line.trim()) continue
                    try {
                      const ev = JSON.parse(line)
                      if (ev.id === eventId) return ev
                    } catch { /* 跳过 */ }
                  }
                } catch { /* 无 */ }
                return null
              })()
              if (!event) return send(res, 404, { ok: false, error: '未找到该事件' })
              const files = (event.files || []).map((f) => '`' + f + '`').join('、')
              const snapDir = SNAPSHOTS_DIR
              // 快照缺失保护：快照被清除后，撤销指令应如实告知 agent，避免其盲目恢复
              // （回退查 snapshotEventId：approved 事件的快照挂在其 pending 事件 id 下）
              const snaps = loadEventSnapshotsWithRef(eventId)
              const snapHint = snaps.length > 0
                ? '改动前的文件内容快照保存在 ' + snapDir + '（按事件 ID 命名），可参考恢复；请确认改动内容后执行撤销。'
                : '注意：该事件已无可用快照（可能已被清除），请基于当前文件内容判断如何恢复原状；无法确定时请先说明再操作。'
              // 块级撤销：body.hunk = { delLines, addLines, ctxLines }，只撤该块、其余保留
              const hunk = body.hunk
              const hasHunk = hunk && typeof hunk === 'object' && !Array.isArray(hunk)
                && (Array.isArray(hunk.delLines) || Array.isArray(hunk.addLines))
              const pick = (v) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x !== '')
              // 畸形 hunk（传了 hunk 但解析不出任何变更行）→ 400，绝不静默升级为整文件撤销
              if (hunk !== undefined && hasHunk) {
                const delCheck = pick(hunk.delLines)
                const addCheck = pick(hunk.addLines)
                if (delCheck.length === 0 && addCheck.length === 0) {
                  return send(res, 400, { ok: false, error: '空改动块：delLines/addLines 均无有效行' })
                }
              }
              if (hunk !== undefined && !hasHunk) {
                return send(res, 400, { ok: false, error: 'hunk 格式无效（需要 delLines/addLines 数组）' })
              }
              // 重复撤销防护（服务端持久态）：同一事件+同一块只允许投递一次
              // hunkKey：整文件='*', 块=事件id+块索引+内容指纹（见 hunkKeyOf 注释）
              const hunkIndex = Number.parseInt(String((hunk && hunk.hunkIndex) ?? ''), 10)
              const _delJoined = hasHunk ? pick(hunk.delLines).join('\n') : ''
              const _addJoined = hasHunk ? pick(hunk.addLines).join('\n') : ''
              const _key = hunkKeyOf(hasHunk, eventId, Number.isInteger(hunkIndex) ? hunkIndex : null, _delJoined, _addJoined)
              const _dup = findRevertRecord(eventId, _key)
              if (_dup) {
                return send(res, 409, {
                  ok: false,
                  error: '该撤销已于 ' + (_dup.ts || '(未知时间)') + ' 执行过，不再重复投递',
                  duplicate: true, ts: _dup.ts || null,
                })
              }
              let content
              if (hasHunk) {
                const delLines = pick(hunk.delLines).map((l) => '- ' + l).join('\n')
                const addLines = pick(hunk.addLines).map((l) => '+ ' + l).join('\n')
                const ctxLines = pick(hunk.ctxLines).slice(0, 3).map((l) => '  ' + l).join('\n')
                const singlePath = typeof body.path === 'string' && body.path.trim() ? '`' + body.path.trim() + '`' : null
                // 指令精度原则：主操作只有两条（恢复 del 行 / 删除 add 行），锚点仅用于定位、绝不作为写入内容。
                // 不再提供"整体替换的目标文本"——锚点行与实际文件行的对应关系因漂移场景不可靠，混合写入会产生重复行
                //（真机验证 2026-09-07：目标文本含锚点行导致执行方把它们追加到文件尾部）。
                content = '请撤销以下自动审批操作中【单个改动块】的文件改动（仅撤销这一块，其余改动一律保留）：\n' +
                  '- 文件：' + (singlePath || files || '(未知)') + '\n' +
                  (addLines ? '- 第 1 步【删除这些行】（本次改动新增的内容，整行删除）：\n```\n' + addLines + '\n```\n' : '') +
                  (delLines ? '- 第 2 步【在删除位置恢复这些行】（本次改动删除的原文，按原顺序插回）：\n```\n' + delLines + '\n```\n' : '') +
                  (ctxLines ? '- 定位锚点（紧邻该块的上下文行，仅用于确认改动位置——不是要写入的内容；若定位失败先说明，不执行）：\n```\n' + ctxLines + '\n```\n' : '') +
                  '- 完成后自查：文件中不应再出现"删除清单"里的任何行；"恢复清单"里的每一行恰好出现一次。\n' +
                  snapHint
              } else {
                content = '请撤销以下自动审批操作带来的文件改动（恢复为审批前的状态）：\n' +
                  '- 操作：' + (event.justification || event.reason || '(无说明)') + '\n' +
                  '- 涉及文件：' + (files || '(未知)') + '\n' +
                  '- 判定：' + (event.verdict || 'auto') + '（自动放行）\n' +
                  '- 事件时间：' + (event.ts || '') + '\n' +
                  snapHint
              }
              const result = await sendToSession(sessionId, content)
              if (result.ok) recordRevert(eventId, _key)
              audit(`REVERT  event=${eventId} session=${sessionId} via=${result.via || 'none'} | ${event.justification ? event.justification.slice(0, 80) : ''}`)
              send(res, result.ok ? 200 : 500, result)
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        offSnapStatsRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/snapshots-stats',
          handler: async (req, res) => {
            try {
              const url = new URL(req.url, 'http://localhost')
              const filterSession = url.searchParams.get('sessionId') || ''
              let count = 0
              let bytes = 0
              const ids = []
              try {
                for (const name of readdirSyncSafe(SNAPSHOTS_DIR)) {
                  if (!name.endsWith('.json')) continue
                  const id = String(name).slice(0, -'.json'.length)
                  // 按会话过滤：读快照 JSON 匹配 sessionId（无过滤时全部计入）
                  if (filterSession && !snapshotMatchesSession(join(SNAPSHOTS_DIR, name), filterSession)) continue
                  count++
                  ids.push(id)
                  try { bytes += statSyncSafe(join(SNAPSHOTS_DIR, name)) } catch { /* 跳过 */ }
                }
              } catch { /* 目录不存在 */ }
              send(res, 200, { ok: true, count, bytes, ids, sessionId: filterSession || null })
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        offSnapClearRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/snapshots-clear',
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
              const body = await readBody(req)
              const filterSession = String((body && body.sessionId) || '')
              let removed = 0
              try {
                for (const name of readdirSyncSafe(SNAPSHOTS_DIR)) {
                  if (!name.endsWith('.json')) continue
                  // 按会话过滤：不匹配则跳过（无过滤时全清）
                  if (filterSession && !snapshotMatchesSession(join(SNAPSHOTS_DIR, name), filterSession)) continue
                  try { rmSyncSafe(join(SNAPSHOTS_DIR, name)); removed++ } catch { /* 跳过 */ }
                }
              } catch { /* 目录不存在 */ }
              audit(`CONFIG  snapshots-clear session=${filterSession || '*'} removed=${removed}`)
              send(res, 200, { ok: true, removed, sessionId: filterSession || null })
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        console.log(`[${NAME}] diff/撤销/快照 API 已注册`)
      } else {
        console.warn(`[${NAME}] webServer 不可用，diff/快照 API 未注册`)
      }
    } catch (error) {
      console.error(`[${NAME}] 注册 diff/快照 API 失败`, error)
    }
    // 已撤销状态查询（只读）：DiffPanel 打开时拉该事件哪些块已撤销过，直接置灰
    let offRevertsRoute = null
    try {
      if (ctx.webServer && typeof ctx.webServer.register === 'function') {
        offRevertsRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/reverts',
          handler: async (req, res) => {
            const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
            try {
              if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
              const url = new URL(req.url, 'http://localhost')
              const eventId = Number.parseInt(url.searchParams.get('eventId') || '', 10)
              if (!Number.isInteger(eventId)) return send(400, { ok: false, error: 'eventId 必填' })
              const hunkKeys = []
              try {
                const text = readFileSync(join(DATA_DIR, 'reverts.jsonl'), 'utf8')
                for (const line of text.split('\n')) {
                  if (!line.trim()) continue
                  try {
                    const r = JSON.parse(line)
                    if (r && r.eventId === eventId && typeof r.hunkKey === 'string') hunkKeys.push(r.hunkKey)
                  } catch { /* 跳过坏行 */ }
                }
              } catch { /* 文件不存在=无撤销记录 */ }
              send(200, { ok: true, eventId, hunkKeys, wholeReverted: hunkKeys.includes('*') })
            } catch (e) {
              send(400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })
      }
    } catch (error) {
      console.error(`[${NAME}] 注册已撤销查询 API 失败`, error)
    }
    ctx.effect(() => () => {
      if (offEventsRoute) { try { offEventsRoute() } catch (e) {} }
      if (offRulesRoute) { try { offRulesRoute() } catch (e) {} }
      if (offDiffRoute) { try { offDiffRoute() } catch (e) {} }
      if (offRevertRoute) { try { offRevertRoute() } catch (e) {} }
      if (offRevertsRoute) { try { offRevertsRoute() } catch (e) {} }
      if (offSnapStatsRoute) { try { offSnapStatsRoute() } catch (e) {} }
      if (offSnapClearRoute) { try { offSnapClearRoute() } catch (e) {} }
    })

    const resolveModel = () => {
      // 优先级: allowlist.classifierModel 显式配置 > 会话默认模型 > 内置回退
      // （错误配置自然回落会话默认模型；POST /rules 不开放 classifierModel 修改，编辑文件生效，避免 UI 误配烧 token）
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

    /**
     * 底层 flash 调用：流式请求并累积文本输出（可取消）。
     * 由 judgeOnce / verifySimilarity 共用；异常向上抛，由 withRetry 决定重试或降级。
     * @returns {Promise<string>} 模型原始输出文本
     */
    const callFlash = async (userText, systemPrompt, signal) => {
      const { provider, model } = resolveModel()
      let text = ''
      for await (const chunk of llm.stream({
        provider,
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        system: systemPrompt,
        temperature: 0,
        reasoningEffort: 'off',
        // 256：结论仅几个词，但模型偶发先输出复述/思考文本，64 会被截断导致解析失败
        maxTokens: 256,
        signal
      })) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'reasoning-delta') text += chunk.text
        else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          const failure = chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : chunk.reason.kind
          throw new Error('flash 调用失败: ' + failure)
        }
      }
      return text
    }

    /**
     * 单次 flash 判定:双协议解析(严格 JSON {"verdict":"approve"|"ask"} 或 SAFE/RISKY:<category>)。
     * 协议解析统一交给 classifier.mjs 的 parseVerdict(裸 RISKY/不确定/NOT SAFE 均按 risky)。
     * @returns {Promise<{verdict:'safe'|'risky', category?:string}>}
     */
    const judgeOnce = async (toolName, mode, justification, signal) => {
      const user = [
        `工具: ${toolName}`,
        `目标沙箱模式: ${mode || '(非越界审批)'}`,
        `操作理由: ${justification || '(无说明)'}`,
        '',
        '请判断：执行该操作是否会造成无法回补的后果或触碰敏感资源？输出 SAFE 或 RISKY:<类别>。'
      ].join('\n')
      const text = await callFlash(user, SYSTEM_PROMPT, signal)
      const verdict = parseVerdict(text)
      if (verdict === 'allow') return { verdict: 'safe' }
      if (verdict === 'risky') return { verdict: 'risky', category: extractCategory(text) }
      if (verdict === 'ask') return { verdict: 'risky', category: 'neutral' }
      throw new Error('flash 输出无法解析: ' + JSON.stringify(text.slice(0, 120)))
    }

    const SIMILARITY_PROMPT = [
      '你是操作意图一致性判断器。用户已人工批准过一些操作（同一工具、同一沙箱模式的例行操作），现在要判断一个新请求是否属于同类。',
      '',
      '你将收到：',
      '- 用户已批准的操作样本（每个样本包含操作背景和目的）',
      '- 一个新操作的背景和目的',
      '',
      '判断规则：',
      '- SAME：新操作与某个样本属于同类操作——操作对象（同一文件/目录/项目/配置/系统）或目的（同一类例行维护、同一次任务的延续）一致或高度相似',
      '- DIFFERENT：新操作的操作对象或目的与所有样本明显不同（不同文件/不同系统/不同性质的操作）',
      '',
      '只输出一个词：SAME 或 DIFFERENT。拿不准时输出 DIFFERENT。不要输出任何其他内容。'
    ].join('\n')

    /**
     * 单次「第三方同类验证」：把本次操作的背景和目的 + 用户历史确认样本给 flash，
     * 判断是否属于已确认的同类操作（语义级，不依赖关键词）。
     * @returns {Promise<{verdict:'same'|'different'}>}
     */
    const verifySimilarity = async (toolName, mode, justification, samples, signal) => {
      const sampleLines = samples
        .map((s, i) => `样本${i + 1}: ${s.ctx || s.fp || '(无描述)'}`)
        .join('\n')
      const user = [
        `工具: ${toolName}`,
        `目标沙箱模式: ${mode || '(非越界审批)'}`,
        '',
        '【用户已批准的操作样本】',
        sampleLines || '（无样本）',
        '',
        '【本次新操作】',
        `操作理由: ${justification || '(无说明)'}`,
        '',
        '请判断：新操作是否与某个已批准样本属于同类操作？输出 SAME 或 DIFFERENT。'
      ].join('\n')
      const text = await callFlash(user, SIMILARITY_PROMPT, signal)
      const trimmed = text.trim().toUpperCase()
      if (trimmed.includes('DIFFERENT')) return { verdict: 'different' }
      if (trimmed.includes('SAME')) return { verdict: 'same' }
      // 无法判断 → 按 different（fail-safe：验证不了就人工）
      if (/无法判断|不确定|无法确定|UNCERTAIN/i.test(text)) return { verdict: 'different' }
      throw new Error('同类验证输出无法解析: ' + JSON.stringify(text.slice(0, 120)))
    }

    /**
     * 通用超时 + 重试包装：runFn(signal) 返回结果对象；
     * 超时 abort 并重试 1 次，仍失败 → { failed: true }（调用方按 fail-safe 处理）。
     * judgeOnce / verifySimilarity 共用；rejection 在 race 内消化（防 unhandled rejection）。
     */
    const withRetry = async (runFn, label) => {
      const timeoutMs = config.judgeTimeoutMs || 20000
      const runOnce = async () => {
        const controller = new AbortController()
        const timer = ctx.timeout(timeoutMs).then(() => {
          controller.abort(`${NAME}: ${label} 超时`)
          return 'timeout'
        })
        try {
          const call = runFn(controller.signal)
            .then((r) => ({ ...r, timedOut: false }))
            .catch((error) => ({ judgeError: error }))
          const result = await Promise.race([call, timer.then(() => ({ timedOut: true }))])
          if (result.judgeError) throw result.judgeError
          return result
        } finally {
          controller.abort(`${NAME}: ${label} 结束`)
        }
      }

      try {
        const first = await runOnce()
        if (!first.timedOut) return first
        console.warn(`[${NAME}] ${label} 超时(${timeoutMs}ms)，重试 1 次`)
      } catch (error) {
        console.error(`[${NAME}] ${label} 异常，重试 1 次`, error)
      }
      try {
        const second = await runOnce()
        if (!second.timedOut) return second
      } catch (error) {
        console.error(`[${NAME}] ${label} 重试仍异常`, error)
        return { failed: true }
      }
      console.warn(`[${NAME}] ${label} 两次超时(${timeoutMs}ms×2)`)
      return { failed: true }
    }

    /** flash 风险判定（带超时重试）：失败 → { verdict:'risky', category:'neutral', failed:true }（fail-safe） */
    const judgeWithFlash = async (toolName, mode, justification) => {
      const result = await withRetry((signal) => judgeOnce(toolName, mode, justification, signal), 'flash 判断')
      if (result.failed) return { verdict: 'risky', category: 'neutral', timedOut: true, failed: true }
      return result
    }

    /** 同类验证（带超时重试）：失败 → { verdict:'different', failed:true }（fail-safe：验证失败按不同类处理） */
    const verifySimilarityWithRetry = async (toolName, mode, justification, samples) => {
      const result = await withRetry((signal) => verifySimilarity(toolName, mode, justification, samples, signal), '同类验证')
      if (result.failed) return { verdict: 'different', failed: true }
      return result
    }

    /** 记录一次人工批准的样本（{fp, ctx}）；同指纹覆盖旧样本；返回本次指纹（可能为 null） */
    const recordSample = (key, justification) => {
      const fp = extractOperationFingerprint(justification)
      const ctx = String(justification || '').slice(0, 200)
      const list = (learning.history[key] || []).slice()
      const idx = fp ? list.findIndex((s) => s.fp === fp) : -1
      if (idx >= 0) list[idx] = { fp, ctx }
      else list.push({ fp, ctx })
      learning.history[key] = list.slice(-10)
      return fp
    }

    ctx.on('approval/request', async (req, next) => {
      try {
        reloadConfig()
        const session = req.agent && req.agent.session
        if (!session) return next()
        let preset
        try {
          // rc.1 的 sessionProjections.stateOf 需要 session.header / inheritedEventCount /
          // snapshotEvents()——只有完整 Session 实例才有；上游 fork 原代码传的 session.events
          // 在 Session 类上不存在(undefined)，导致 derive 必崩(fail-safe 转人工)。
          preset = permissionPresets.current(session)
        } catch (error) {
          console.error(`[${NAME}] permissionPresets.current failed`, error)
          audit(`PRESET  current() failed: ${error && error.message}`)
          return next()
        }
        if (preset !== PRESET_NAME) {
          // 非 auto-approve 预设：静默放行给下游应答者(正常路径，不刷审计)
          return next()
        }
        if (req.signal && req.signal.aborted) return next()

        const toolName = String(req.toolName || 'unknown')
        const reason = String(req.reason || '')
        const { mode, justification } = parseReason(reason)
        const sessionId = typeof session.id === 'string' ? session.id : ''
        // 会话工作目录：相对路径快照解析的基准（DSH SessionHeader.cwd）
        const sessionCwd = (typeof session.cwd === 'string' && session.cwd) ? session.cwd : ''
        // B 层：callId 回溯 tool/call 事件取结构化真实路径（edit/write 的 file_path / bash 的 command）。
        // 适配（e1f26a4）：rc.1 的 Session 类没有 events 属性，事件须经 session.snapshotEvents() 获取；
        // resolveToolCallFiles 的 events 是参数数组，不依赖 session.events。
        // C 层兜底：未命中时 recordApprovalEvent 内部回退 extractFiles(justification)
        const toolFiles = resolveToolCallFiles(req.callId, session.snapshotEvents())
        const filesOpt = toolFiles ? { files: toolFiles, baseDir: sessionCwd } : { baseDir: sessionCwd }

        // 转人工统一处理：记录 pending → 交下游（web answerer）→ 记录终态事件（关闭提示条）。
        // 终态事件带 snapshotEventId 指回 pending 事件——快照文件挂在 pending 事件 id 下，
        // 用户在批准后的终态事件上点文件 chip 时 diff/撤销端点据此回退查快照
        const forwardToHuman = async (sid, tName, tMode, rsn, jst, cat, why) => {
          const pendingEv = recordApprovalEvent(sid, tName, tMode, rsn, jst, 'manual-pending', Object.assign({ kind: 'manual-pending', category: cat || '', path: why }, filesOpt))
          const out = await next()
          if (out === 'allowed-once') {
            recordApprovalEvent(sid, tName, tMode, rsn, jst, 'manual-approved', Object.assign({ kind: 'manual-approved', category: cat || '', path: why, snapshotEventId: pendingEv.id }, filesOpt))
          } else if (out === 'rejected') {
            recordApprovalEvent(sid, tName, tMode, rsn, jst, 'manual-rejected', Object.assign({ kind: 'manual-rejected', category: cat || '', path: why, snapshotEventId: pendingEv.id }, filesOpt))
          }
          return out
        }

        // 1. DENY 层：不可逆危险词 → 转人工（fail-safe，最高优先）
        if (looksDeny(toolName + ' ' + reason)) {
          audit(`DENY    ${toolName} mode=${mode || 'none'} | ${reason.slice(0, 160)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, '', 'deny')
        }

        // 2. 白名单层：命中规则 → 直接放行（确定性，不过 flash）
        const matchedRule = matchRule(config.allowRules, toolName, mode, null, justification)
        if (matchedRule) {
          audit(`ALLOW   ${toolName} mode=${mode || 'none'} (rule: ${matchedRule.description || 'matched'})`)
          recordAutoAllow(sessionId, toolName, mode, reason, justification, 'rule', filesOpt)
          return 'allowed-once'
        }

        // 3. flash 判定
        const { verdict, category, timedOut, failed } = await judgeWithFlash(toolName, mode, justification)

        if (verdict === 'safe') {
          audit(`ALLOW   ${toolName} mode=${mode || 'none'} (flash-safe${timedOut ? '，重试后' : ''})`)
          recordAutoAllow(sessionId, toolName, mode, reason, justification, 'flash-safe', filesOpt)
          return 'allowed-once'
        }

        const cat = category || 'neutral'

        // 4a. flash 完全失败（超时×2/异常×2）→ 转人工（fail-safe：无法判断绝不自动放行）
        if (failed) {
          audit(`FAILED  ${toolName} mode=${mode || 'none'} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'flash-failed')
        }

        // 4b. 硬风险类别（deletion/credential/remote/system/bulk）→ 直接转人工（必须人工确认，不计数不学习）
        const hard = config.hardCategories || DEFAULT_HARD_CATEGORIES
        if (hard.includes(cat)) {
          audit(`HARD    ${toolName} mode=${mode || 'none'} category=${cat} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'hard-category')
        }

        // 4c. 协议外类别（模型输出未知类别）→ 判定不可靠，fail-safe 转人工
        if (cat !== 'neutral') {
          audit(`UNKNOWN ${toolName} mode=${mode || 'none'} category=${cat} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'unknown-category')
        }

        // 4d. denyRules 命中（此前用户裁决拒绝过的 key）→ 直接转人工（拒绝优先于沉淀）
        if (matchRule(config.denyRules, toolName, mode, cat, justification)) {
          audit(`DENYRULE ${toolName} mode=${mode || 'none'} category=${cat} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'deny-rule')
        }

        // 4e. 沉淀规则（带 category 的学习规则，用户批准过）→ 直接放行，不再计数
        const key = learnKey(toolName, mode, cat)
        const learnedRule = matchRule(config.allowRules, toolName, mode, cat, justification)
        if (learnedRule) {
          audit(`ALLOW   ${toolName} mode=${mode || 'none'} (rule: ${learnedRule.description || '沉淀规则'})`)
          delete learning.stats[key]
          saveJson(LEARNING_PATH, learning)
          recordAutoAllow(sessionId, toolName, mode, reason, justification, 'learned', filesOpt)
          return 'allowed-once'
        }

        // 4f. 中立类别（neutral）：人工确认学习制（方案 B 约束）——确认满 N 次后，操作指纹强命中才自动放行；
        //     学习沉淀只写 learning.json（stats/history 持久保留），不写 allowRules 主表，
        //     /approval-core-clear-learning 一键全撤。无指纹不沉淀，一律人工。
        const threshold = config.riskyThreshold || DEFAULT_RISKY_THRESHOLD
        const confirmed = learning.stats[key] || 0

        if (confirmed >= threshold) {
          const fingerprint = extractOperationFingerprint(justification)
          const samples = learning.history[key] || []
          const fpHit = shouldPrecipitate({ confirmed, threshold, fingerprint, samples })

          // learning.enabled 是学习放行总开关（方案 B）：显式 false 时即使指纹命中也不自动放行，
          // 落到下方人工确认路径（开关关闭 = 回到每次人工，最保守语义）
          if (fpHit && learning.enabled !== false) {
            // ① 指纹确定性命中（用户确认过该操作）→ 自动放行。
            //    stats/history 保留在 learning.json 供后续同类请求继续命中（沉淀即学习态本身）
            audit(`ALLOW   ${toolName} mode=${mode || 'none'} (neutral-learned=${confirmed + 1}/${threshold}) | ${reason.slice(0, 100)}`)
            recordAutoAllow(sessionId, toolName, mode, reason, justification, 'fpHit', Object.assign({ path: 'auto-learned' }, filesOpt))
            return 'allowed-once'
          }

          if (samples.length > 0) {
            // 指纹未命中 → flash 第三方同类验证：把本次操作背景 + 用户确认样本给 flash，
            // 语义判断是否属于已确认的同类操作（不依赖关键词）。flash-same 自动放行同属学习放行，
            // 同受 learning.enabled 总开关管：显式 false 时不验证不自动放行，直接落人工确认
            if (learning.enabled !== false) {
              const sim = await verifySimilarityWithRetry(toolName, mode, justification, samples)
              if (sim.verdict === 'same') {
                // 判同类 → 自动放行；有指纹则沉淀进 learning.json（history 补记该指纹，下次同操作直接 fp-hit）
                if (fingerprint) {
                  recordSample(key, justification)
                  saveJson(LEARNING_PATH, learning)
                  audit(`LEARN   ${key} flash 判同类，已沉淀指纹 ${fingerprint}`)
                } else {
                  // 无指纹：不沉淀，保留样本与阈值位（下次同操作仍靠 flash 验证放行）
                  audit(`SAME    ${toolName} mode=${mode || 'none'} category=${cat} flash 判同类（未沉淀）| ${reason.slice(0, 100)}`)
                }
                audit(`ALLOW   ${toolName} mode=${mode || 'none'} (flash-same) | ${reason.slice(0, 100)}`)
                recordAutoAllow(sessionId, toolName, mode, reason, justification, 'flash-same', Object.assign({ path: 'auto-learned' }, filesOpt))
                return 'allowed-once'
              }
              // 判 DIFFERENT / 验证失败 → 落人工确认
              audit(`SIMDIFF ${toolName} mode=${mode || 'none'} category=${cat} flash 判不同类 → 人工 | ${reason.slice(0, 120)}`)
            }
          }

          // 指纹未命中（且无样本可验证 / 判不同类）：转人工确认
          audit(`RISKY   ${toolName} mode=${mode || 'none'} category=${cat} confirm=${confirmed + 1}/${threshold}（操作未确认过）→ 人工 outcome=? | ${reason.slice(0, 120)}`)
          const pendingEv = recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-pending', Object.assign({ kind: 'manual-pending', category: cat, path: 'neutral-confirm' }, filesOpt))
          const outcome = await next()
          audit(`OUTCOME ${key} outcome=${outcome} | ${reason.slice(0, 80)}`)
          if (outcome === 'allowed-once' && learning.enabled) {
            // 批准 → 记录本次操作样本（背景+指纹）；计数保持阈值位
            recordSample(key, justification)
            saveJson(LEARNING_PATH, learning)
            recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-approved', Object.assign({ kind: 'manual-approved', learningCount: confirmed, threshold, category: cat, path: 'human-approved', snapshotEventId: pendingEv.id }, filesOpt))
          } else if (outcome === 'rejected') {
            // 拒绝 → 永久人工（带指纹；提取不到则拦全部同类，拒绝从严）
            const rule = { tool: toolName, category: cat }
            if (mode) rule.mode = mode
            if (fingerprint) rule.contains = fingerprint
            if (!config.denyRules.some((r) => r.tool === rule.tool && r.mode === rule.mode && r.category === rule.category && r.contains === rule.contains)) {
              config.denyRules.push(rule)
              saveJson(ALLOWLIST_PATH, config)
              audit(`LEARN   ${key} 被人工拒绝，已升级永久人工 ${JSON.stringify(rule)}`)
            }
            delete learning.stats[key]
            delete learning.history[key]
            saveJson(LEARNING_PATH, learning)
            recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-rejected', Object.assign({ kind: 'manual-rejected', category: cat, path: 'learned-removed', snapshotEventId: pendingEv.id }, filesOpt))
          }
          return outcome
        }

        // 前 N 次 → 人工确认
        audit(`RISKY   ${toolName} mode=${mode || 'none'} category=${cat} confirm=${confirmed + 1}/${threshold} → 人工 outcome=? | ${reason.slice(0, 120)}`)
        const pendingEv = recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-pending', Object.assign({ kind: 'manual-pending', category: cat, path: 'neutral-confirm' }, filesOpt))
        const outcome = await next()
        audit(`OUTCOME ${key} outcome=${outcome} | ${reason.slice(0, 80)}`)

        if (outcome === 'allowed-once' && learning.enabled) {
          // 批准 → 确认计数 +1，并记录本次操作样本（未达阈值，下次同类仍人工确认）
          learning.stats[key] = confirmed + 1
          recordSample(key, justification)
          saveJson(LEARNING_PATH, learning)
          recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-approved', Object.assign({ kind: 'manual-approved', learningCount: confirmed + 1, threshold, category: cat, path: 'human-approved', snapshotEventId: pendingEv.id }, filesOpt))
        } else if (outcome === 'rejected') {
          // 拒绝 → 升级为永久人工规则（带操作指纹；提取不到则拦全部同类，拒绝从严）
          const fingerprint = extractOperationFingerprint(justification)
          const rule = { tool: toolName, category: cat }
          if (mode) rule.mode = mode
          if (fingerprint) rule.contains = fingerprint
          if (!config.denyRules.some((r) => r.tool === rule.tool && r.mode === rule.mode && r.category === rule.category && r.contains === rule.contains)) {
            config.denyRules.push(rule)
            saveJson(ALLOWLIST_PATH, config)
            audit(`LEARN   ${key} 被人工拒绝，已升级永久人工 ${JSON.stringify(rule)}`)
          }
          delete learning.stats[key]
          delete learning.history[key]
          saveJson(LEARNING_PATH, learning)
          recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-rejected', Object.assign({ kind: 'manual-rejected', category: cat, path: 'learned-removed', snapshotEventId: pendingEv.id }, filesOpt))
        }
        // cancelled/unavailable：不计数（用户未表态，下次仍人工确认）
        return outcome
      } catch (error) {
        console.error(`[${NAME}] 判断过程出错，回退人工`, error)
        return next()
      }
    }, { prepend: true })

    // ---- 一键清空学习沉淀（学习态独立于白名单主表，存于 learning.json） ----
    try {
      ctx.inject(['commands'], (commandCtx) => {
        commandCtx.commands.register({
          name: 'approval-core-clear-learning',
          description: '清空全部学习沉淀（独立于白名单主表）',
          handler: () => {
            const cleared = clearLearning(learning)
            saveJson(LEARNING_PATH, cleared)
            Object.assign(learning, cleared)
            audit(`LEARN-CLR 全部学习记录已清空`)
            return { kind: 'success', text: '学习记录已清空（stats 与 history）' }
          },
        })
        console.log(`[${NAME}] 命令已注册：/approval-core-clear-learning`)
      })
    } catch (error) {
      console.warn(`[${NAME}] /approval-core-clear-learning 注册失败（宿主无 commands 服务时忽略）`, error)
    }

    console.log(`[${NAME}] v3 已挂载：DENY(正则危险清单)→白名单→denyRules→flash(SAFE/硬类别/中立计数${config.riskyThreshold})→裁决学习（配置: ${ALLOWLIST_PATH}）`)
  },
}
