import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as mem from '../packages/core/lib/self-memory.js'

const root = fileURLToPath(new URL('../', import.meta.url))
void root

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-core-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('then 固定，later 只追加', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, {
    text: '读到社办门口那段',
    thought: '再不说就没牵扯了',
    feeling: ['闷'],
    quote: { text: '我也很开心', source: '第3章' }
  })
  assert.equal(exp.currentView(dir, row.id).then.thought, '再不说就没牵扯了')

  exp.reviseExperience(dir, { id: row.id, thought: '现在觉得他在护着朋友' })
  exp.reviseExperience(dir, { id: row.id, thought: '也可能只是累' })

  const view = exp.currentView(dir, row.id)
  assert.equal(view.then.thought, '再不说就没牵扯了', '当时不能被改')
  assert.equal(view.then.text, '读到社办门口那段')
  assert.equal(view.then.quote.text, '我也很开心')
  assert.deepEqual(view.later.map(x => x.thought), ['现在觉得他在护着朋友', '也可能只是累'])
})

test('recall 命中相关的那条，空查询不硬凑', (t) => {
  const dir = tmp(t)
  const lighthouse = exp.addExperience(dir, { text: '翻到灯塔那一章', thought: '她怕黑' })
  exp.addExperience(dir, { text: '学会一种新的折纸' })
  exp.addExperience(dir, { text: '走到码头看船' })

  const hits = exp.recall(dir, '灯塔', { limit: 1 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, lighthouse.id)

  assert.deepEqual(exp.recall(dir, '量子力学'), [])
})

test('文件里有坏行时，新经历仍能写入且坏行原样保留', (t) => {
  const dir = tmp(t)
  const file = path.join(dir, 'self-experience.jsonl')
  fs.writeFileSync(file, '{"id":"good","then":{"text":"旧的"}}\n{"broken":\n', 'utf8')

  const row = exp.addExperience(dir, { text: '新的一条' })
  const raw = fs.readFileSync(file, 'utf8')

  assert.ok(raw.includes('{"broken":'), '坏行不能被悄悄丢掉')
  assert.ok(raw.includes(row.id), '新行要写进去')
  assert.ok(!raw.endsWith('\\n'), '不能把换行写成字面量')

  const lines = raw.trim().split('\n')
  const good = lines.filter(l => { try { JSON.parse(l); return true } catch { return false } })
  assert.equal(good.length, 2, '旧的有效行 + 新行')
})

test('改主意是追加事件：坏行不被碰，正文不重写', (t) => {
  const dir = tmp(t)
  const file = path.join(dir, 'self-experience.jsonl')
  const original = '{"id":"good","then":{"text":"旧的"}}\n{"broken":\n'
  fs.writeFileSync(file, original, 'utf8')

  const res = exp.reviseExperience(dir, { id: 'good', thought: '新的' })
  assert.equal(res.ok, true)
  assert.equal(fs.readFileSync(file, 'utf8'), original, '经历文件一个字节都不该动')

  const view = exp.currentView(dir, 'good')
  assert.equal(view.then.text, '旧的')
  assert.equal(view.later.at(-1).thought, '新的')
})

test('日记默认不出现，显式打开才出现', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '读完灯塔那一章', thought: '她怕黑' })
  fs.writeFileSync(
    path.join(dir, 'autobiography.jsonl'),
    JSON.stringify({ day: '2026-11-14', event: '灯塔下着雨，我没带伞' }) + '\n',
    'utf8'
  )

  const closed = mem.recall(dir, '灯塔', { includeDiary: false })
  assert.equal(closed.some(r => r.origin === 'diary'), false)

  const opened = mem.recall(dir, '灯塔', { includeDiary: true })
  assert.equal(opened.some(r => r.origin === 'diary'), true)
})
test('召回会记一次“想起”，计数跟着涨', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '翻到灯塔那一章' })

  const first = exp.recall(dir, '灯塔', { limit: 1, mark: true })
  assert.equal(first[0].recalls, 1, '这次取回本身就是第 1 次想起')
  assert.equal(exp.renderTwoPart(first[0]).includes('想起过 1 次'), true)

  const second = exp.recall(dir, '灯塔', { limit: 1, mark: true })
  assert.equal(second[0].recalls, 2)
  assert.equal(exp.currentView(dir, row.id).recalls, 2)

  const plain = exp.recall(dir, '灯塔', { limit: 1, mark: false })
  assert.equal(plain[0].recalls, 2, 'mark:false 只读不记')
})

test('recallForContext：给宿主的轻量结构，字段齐全', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '灯塔', thought: '怕黑' })
  const out = exp.recallForContext(dir, '灯塔', { max: 1 })
  assert.equal(out.length, 1)
  assert.equal(out[0].id, row.id)
  assert.equal(out[0].text, '灯塔')
  assert.equal(out[0].thought, '怕黑')
  assert.equal(out[0].raw.id, row.id)
})

test('召回模式：strict 宁可不召回，loose 至少给一个实词命中', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, {
    text: '读到烤肉那段，笑了一下',
    thought: '这种好事只在书里',
    unfinished: '想知道小鞠和社长后来怎样了'
  })
  const longQuery = '那本书里那个人后来怎样了'

  assert.deepEqual(exp.recall(dir, longQuery, { limit: 3 }), [], 'strict 下长问句不硬凑')
  const loose = exp.recall(dir, longQuery, { limit: 3, mode: 'loose' })
  assert.equal(loose.length, 1, 'loose 下应给出一句"书里"相关的记录')
  assert.match(loose[0].then.thought, /书里/)
})
