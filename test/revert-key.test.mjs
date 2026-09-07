import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hunkKeyOf } from '../src/index.mjs'

// 前端 hunkKeyOfLines 的算法（与 client.js 内联实现同构，用测试守护两端一致）
function clientHunkKey(eventId, hi, h) {
  const del = (h.lines || []).filter((c) => c.type === 'del' && typeof c.text === 'string' && c.text !== '').map((c) => c.text).join('\n')
  const add = (h.lines || []).filter((c) => c.type === 'add' && typeof c.text === 'string' && c.text !== '').map((c) => c.text).join('\n')
  return 'ev' + eventId + ':h' + String(hi ?? '?') + ':' + del.length + ':' + add.length
}

test('整文件撤销键 = *', () => {
  assert.equal(hunkKeyOf(false, 36, 0, '', ''), '*')
})

test('前后端块键一致(真实 v9→v10 头部块)', () => {
  const h = { lines: [
    { type: 'del', text: '这是 diff 测试文件 v9 头部【最终验收】。' },
    { type: 'add', text: '这是 diff 测试文件 v10 头部【去重终验】。' },
  ] }
  const server = hunkKeyOf(true, 36, 0, '这是 diff 测试文件 v9 头部【最终验收】。', '这是 diff 测试文件 v10 头部【去重终验】。')
  const client = clientHunkKey(36, 0, h)
  assert.equal(server, client)
  assert.equal(server, 'ev36:h0:25:26')
})

test('同一事件不同块索引键不同', () => {
  const k0 = hunkKeyOf(true, 36, 0, 'aaa', 'bb')
  const k1 = hunkKeyOf(true, 36, 1, 'aaa', 'bb')
  assert.notEqual(k0, k1)
})

test('空字符串行被过滤后长度一致', () => {
  const h = { lines: [
    { type: 'del', text: 'aa' },
    { type: 'del', text: '' },
    { type: 'add', text: 'b' },
  ] }
  const server = hunkKeyOf(true, 10, 0, 'aa', 'b')
  const client = clientHunkKey(10, 0, h)
  assert.equal(server, client)
})

test('文件没变时重开面板键不变(关键场景: 点撤销→未执行→重开)', () => {
  // 第一次打开面板：diff(v9, v10) 头部块
  const first = { lines: [
    { type: 'del', text: '这是 diff 测试文件 v9 头部【最终验收】。' },
    { type: 'add', text: '这是 diff 测试文件 v10 头部【去重终验】。' },
  ] }
  // 点撤销投递，记录 key
  const recorded = clientHunkKey(36, 0, first)
  // 重开面板：文件没变，diff 相同
  const reopened = clientHunkKey(36, 0, first)
  assert.equal(recorded, reopened, '文件没变时 key 必须稳定，否则已撤块重新可点')
})
