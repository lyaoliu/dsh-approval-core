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
