// Task 7: pipeline.test.mjs — 决策管道端到端行为回归
// 纯函数层面模拟一次审批请求的走查:危险先决(①)→ 分类(④)→ 学习判定(⑥)。
// decide() 仅为测试编排,不替代 src/index.mjs 的真实接线;对已实现行为做回归固化。
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
