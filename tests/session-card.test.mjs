// S3 · 开局短卡（K3）
//
// 验收口径：
// 1. 默认关：不传 enabled 就是空串（宿主不加分支，0.27.0 的提示词逐字不变）；
// 2. 打开时 ≤ 220 字，含"读不到别编"，认人（名字）与档案位置都在；
// 3. 不读盘、不发请求：源码里没有 fs / http / fetch；目录不存在也照常返回；
// 4. 纯函数：同样输入逐字相同，不传 today 就不会冒出"今天"；
// 5. 字段拉满时仍然 ≤ 220，且纪律那一行一个字都不少。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { tmpDir, safeRemove } from './_safety.mjs'
import { sessionCard } from '../packages/core/lib/session-card.js'

const chars = (text) => Array.from(String(text)).length
const DISCIPLINE = '读不到别编——没记录的事就说没有，别补。'

test('S3：默认关——不传 enabled 返回空串', () => {
  assert.equal(sessionCard(), '')
  assert.equal(sessionCard({}), '')
  assert.equal(sessionCard({ enabled: false, name: '鲸鲸', memoryDir: 'D:\\记忆' }), '')
  assert.equal(sessionCard({ enabled: 1, name: '鲸鲸' }), '', '只认 true，别的真值一律当关')
})

test('S3：打开时是短卡——认人、档案位置、读不到别编，且 ≤ 220 字', () => {
  const card = sessionCard({ enabled: true, name: '鲸鲸', memoryDir: 'C:\\Users\\32491\\QQAgentData\\memory', today: '2026-11-27' })
  assert.ok(chars(card) <= 220, '短卡不许超 220 字，实际 ' + chars(card))
  assert.ok(card.includes('鲸鲸'), '要认人')
  assert.ok(card.includes('QQAgentData\\memory'), '要给档案位置')
  assert.ok(card.includes('读不到别编'), '要有"读不到别编"')
  assert.ok(card.includes('今天：2026-11-27'), '传了 today 就写进去')
  assert.ok(card.split('\n').length <= 5, '短卡不该长成一大段')
})

test('S3：没名字就不写认人那一行，纪律那一行永远在', () => {
  const card = sessionCard({ enabled: true, memoryDir: 'D:\\记忆' })
  assert.ok(card.includes(DISCIPLINE))
  assert.equal(card.includes('你是'), false)
  const bare = sessionCard({ enabled: true })
  assert.equal(bare, DISCIPLINE, '什么都不给也要留下纪律这一行')
})

test('S3：不读盘、不发请求（源码里没有 fs / http / fetch，目录不存在也照常返回）', () => {
  const source = fs.readFileSync(new URL('../packages/core/lib/session-card.js', import.meta.url), 'utf8')
  for (const forbidden of ["node:fs", "node:http", "node:https", "node:net", "fetch(", "XMLHttpRequest"]) {
    assert.equal(source.includes(forbidden), false, '开局短卡不该碰 ' + forbidden)
  }
  const dir = tmpDir('whale-card-')
  try {
    const missing = path.join(dir, '根本不存在')
    const card = sessionCard({ enabled: true, name: '鲸鲸', memoryDir: missing })
    assert.ok(card.includes('读不到别编'))
    assert.deepEqual(fs.readdirSync(dir), [], '调用短卡不许在磁盘上留下任何东西')
  } finally {
    safeRemove(dir)
  }
})

test('S3：纯函数——同样输入逐字相同，不传 today 不会冒出"今天"', () => {
  const input = { enabled: true, name: '鲸鲸', memoryDir: 'D:\\记忆', extra: '今晚别熬夜' }
  assert.equal(sessionCard(input), sessionCard(input))
  assert.equal(sessionCard(input).includes('今天'), false, '没给 today 就不该自己取当前时间')
  assert.ok(sessionCard(input).includes('今晚别熬夜'))
})

test('S3：字段拉满仍 ≤ 220，纪律那一行一个字都不少', () => {
  const card = sessionCard({
    enabled: true,
    name: '名'.repeat(24),
    memoryDir: 'D'.repeat(100),
    today: '2026-11-27',
    extra: '提'.repeat(40)
  })
  assert.ok(chars(card) <= 220, '拉满也不许超 220，实际 ' + chars(card))
  assert.ok(card.includes(DISCIPLINE), '拉满时纪律那一行不许被截断')
})

test('S3：超长字段按方向截断（名字留头、路径留尾），换行被压平', () => {
  const card = sessionCard({
    enabled: true,
    name: '鲸'.repeat(40),
    memoryDir: 'C:\\Users\\32491\\QQAgentData\\'.repeat(6) + 'memory',
    extra: '第一行\n第二行'
  })
  assert.ok(card.includes('鲸…'), '名字留头')
  assert.ok(card.includes('…') && card.includes('memory'), '路径留尾（尾巴才是记忆在哪）')
  assert.ok(card.includes('第一行 第二行'), '备注里的换行要压成空格，别把短卡拆乱')
})