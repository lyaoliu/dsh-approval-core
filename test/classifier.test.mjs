import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStrictJson, parseRisk, parseVerdict } from '../src/classifier.mjs'

test('严格 JSON 只认精确形式', () => {
  assert.equal(parseStrictJson('{"verdict":"approve"}'), 'approve')
  assert.equal(parseStrictJson('{"verdict":"ask"}'), 'ask')
  assert.equal(parseStrictJson('{"verdict":"maybe"}'), undefined)
  assert.equal(parseStrictJson('{"verdict":"approve","extra":1}'), undefined)
  assert.equal(parseStrictJson('SAFE'), undefined)
  assert.equal(parseStrictJson(''), undefined)
})

test('SAFE/RISKY 协议', () => {
  assert.deepEqual(parseRisk('SAFE'), { verdict: 'safe' })
  assert.deepEqual(parseRisk('RISKY:deletion'), { verdict: 'risky', category: 'deletion' })
  assert.deepEqual(parseRisk('输出: RISKY: credential'), { verdict: 'risky', category: 'credential' })
  assert.deepEqual(parseRisk('我无法判断该操作的风险'), { verdict: 'risky', category: 'neutral' })
  assert.deepEqual(parseRisk('CANNOT JUDGE'), { verdict: 'risky', category: 'neutral' })
  assert.equal(parseRisk('随便说点什么'), undefined)
})

test('统一入口', () => {
  assert.equal(parseVerdict('{"verdict":"approve"}'), 'allow')
  assert.equal(parseVerdict('{"verdict":"ask"}'), 'ask')
  assert.equal(parseVerdict('SAFE'), 'allow')
  assert.equal(parseVerdict('RISKY:system'), 'risky')
  assert.equal(parseVerdict('garbage'), undefined)
})

test('UNSAFE / NOT SAFE / NOT-SAFE 不误判为 safe(fail-safe)', () => {
  assert.equal(parseRisk('UNSAFE to run'), undefined)
  assert.deepEqual(parseRisk('NOT SAFE at all'), { verdict: 'risky', category: 'neutral' })
  assert.deepEqual(parseRisk('NOT-SAFE'), { verdict: 'risky', category: 'neutral' })
  assert.deepEqual(parseRisk('NOT-SAFE: deletion'), { verdict: 'risky', category: 'neutral' })
  assert.deepEqual(parseRisk('NOT- SAFE'), { verdict: 'risky', category: 'neutral' })
  assert.deepEqual(parseRisk('无法判断,感觉SAFE'), { verdict: 'risky', category: 'neutral' })
  assert.deepEqual(parseRisk('SAFE'), { verdict: 'safe' })
  assert.deepEqual(parseRisk('输出: SAFE'), { verdict: 'safe' })
})
