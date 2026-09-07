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
  if (/\bNOT[\s-]*SAFE\b/.test(trimmed)) return { verdict: 'risky', category: 'neutral' }
  if (UNCERTAIN_RE.test(String(text ?? ''))) return { verdict: 'risky', category: 'neutral' }
  if (/\bSAFE\b/.test(trimmed)) return { verdict: 'safe' }
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
