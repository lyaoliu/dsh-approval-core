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

/** 归一化条目:字符串去首尾空白;对象剥除 description 后比较。导出供服务端路由复用。 */
export function normalizeItem(item) {
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
