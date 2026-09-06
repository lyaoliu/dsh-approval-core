// Task 4: learning.mjs — 方案 B 约束学习模块
// 用户人工确认同类操作满阈值(默认 5)且指纹强命中才自动放行;
// 提取不到指纹不沉淀;支持一键清空。纯模块无依赖。
// 指纹提取移植自 approval-gate(src/index.mjs),GENERIC_EN_WORDS 保持同一集合。

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
  // 1a. Windows 盘符路径:C:/xxx/yyy(:不在通用路径字符类内,需单独提取;单字母+冒号
  // 不会误伤 https: 等方案前缀,因为方案名末字母前无词边界)
  for (const m of s.matchAll(/\b[A-Za-z]:[\/\\][\w@.\/\\-]+/g)) {
    const seg = m[0].replace(/[，。；、,.;:：\s]+$/g, '').trim()
    if (seg.length >= 5 && seg.length <= 80) candidates.push(seg)
  }
  // 1. 显式路径片段:~/xxx、/xxx/yyy、相对路径(含至少一段目录或文件名)
  for (const m of s.matchAll(/(?:~\/|\/|\.\/)?[\w@.-]+\/[\w@.\/-]+/g)) {
    const seg = m[0].replace(/[，。；、,.;:：\s]+$/g, '').trim()
    if (seg.length >= 5 && seg.length <= 80) candidates.push(seg)
  }
  // 2. 带扩展名的文件名:xxx.md/.js/.json/.yml/.env 等
  for (const m of s.matchAll(/[\w@.-]+\.(?:md|js|json|ya?ml|env|txt|py|ts|css|html|log|mjs|cjs)/gi)) {
    const seg = m[0]
    if (seg.length >= 4 && seg.length <= 60) candidates.push(seg)
  }
  // 3. 连字符/点分隔的项目或插件名(2-4 段英文标识符)
  for (const m of s.matchAll(/\b[a-z][\w-]*(?:[-.][a-z][\w-]*){1,3}\b/gi)) {
    const seg = m[0]
    if (seg.length >= 6 && seg.length <= 50 && !/^(workspace-write|danger-full-access)$/i.test(seg)) {
      candidates.push(seg)
    }
  }
  // 4. 单段英文标识符(≥5 字符,排除通用动词/操作词):README、config 等文档/配置名
  for (const m of s.matchAll(/\b[a-z][a-z0-9-]{4,}\b/gi)) {
    const seg = m[0]
    if (GENERIC_EN_WORDS.has(seg.toLowerCase())) continue
    if (seg.length <= 40) candidates.push(seg)
  }
  if (candidates.length === 0) return null
  // 取最长片段(最长最有区分度),截断防超长
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
