import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reverseHunk } from '../src/index.mjs'

test('纯删除块: target=原文恢复, 行号来自 aNo', () => {
  const r = reverseHunk([
    { type: 'del', aNo: 5, text: '旧行 A' },
    { type: 'del', aNo: 6, text: '旧行 B' },
  ])
  assert.equal(r.targetText, '旧行 A\n旧行 B')
  assert.equal(r.aStart, 5)
  assert.equal(r.aEnd, 6)
})

test('纯新增块: target 为空(整块删掉), 行号来自 bNo', () => {
  const r = reverseHunk([
    { type: 'add', bNo: 10, text: '新行 X' },
    { type: 'add', bNo: 11, text: '新行 Y' },
  ])
  assert.equal(r.targetText, '')
  assert.equal(r.bStart, 10)
  assert.equal(r.bEnd, 11)
  assert.equal(r.aStart, null)
})

test('混合块: del 恢复 + add 丢弃 + same 保留', () => {
  const r = reverseHunk([
    { type: 'same', aNo: 4, bNo: 4, text: '上下文上' },
    { type: 'del', aNo: 5, text: '删掉的原文' },
    { type: 'add', bNo: 5, text: '新增的内容' },
    { type: 'same', aNo: 6, bNo: 6, text: '上下文下' },
  ])
  assert.equal(r.targetText, '上下文上\n删掉的原文\n上下文下')
  assert.equal(r.aStart, 4)
  assert.equal(r.aEnd, 6)
  assert.equal(r.bStart, 4)
  assert.equal(r.bEnd, 6)
})

test('空输入与畸形行: 不抛, 返回空目标', () => {
  assert.deepEqual(reverseHunk([]), { targetText: '', aStart: null, aEnd: null, bStart: null, bEnd: null })
  assert.deepEqual(reverseHunk(null), { targetText: '', aStart: null, aEnd: null, bStart: null, bEnd: null })
  assert.deepEqual(reverseHunk([{ type: 'del' }, null, { type: 'add', text: 123 }]).targetText, '')
})

test('真机复现: v6 第二块(del v5/ add v6/ ctx 填充)目标 = v5 原文+锚点', () => {
  const r = reverseHunk([
    { type: 'del', aNo: 16, text: '第 16 行：v5 尾部内容。' },
    { type: 'add', bNo: 17, text: '第 16 行：v6 尾部内容【已改第二块】。' },
    { type: 'same', aNo: 15, bNo: 16, text: '填充行 14。' },
  ])
  assert.ok(r.targetText.includes('第 16 行：v5 尾部内容。'))
  assert.ok(!r.targetText.includes('v6'))
  assert.ok(r.targetText.includes('填充行 14。'))
})
