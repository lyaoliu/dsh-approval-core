import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PERMISSION_LEVELS, classifyOp, validateValue, normalizeItem } from '../src/configRules.mjs'

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

test('normalizeItem: 导出且剥除 description', () => {
  assert.deepEqual(normalizeItem({ tool: 'edit', description: 'x' }), { tool: 'edit' })
})
