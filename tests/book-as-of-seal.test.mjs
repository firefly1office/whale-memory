// 她的书（as-of）：历史导出只按那天的封存状态过滤，不泄漏现在的封存状态与条数。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { renderBook } from '../packages/core/lib/book.js'
import { safeRemove, tmpDir } from './_safety.mjs'

function tmp(t) {
  const dir = tmpDir('whale-book-asof-')
  t.after(() => safeRemove(dir))
  return dir
}

const put = (dir, name, rows) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}
const base = { author: 'self', source: 'own-time', kind: '其它', weight: 'normal', later: [], status: 'kept' }
const row = (id, at, text, extra = {}) => ({
  ...base, id, at, day: at.slice(0, 10),
  then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: { at }, ...extra }
})

function library(dir) {
  put(dir, 'self-experience.jsonl', [
    row('exp_hurt', '2026-11-10T12:00:00.000Z', '那天被当众批评，很难堪'),
    row('exp_ok', '2026-11-10T13:00:00.000Z', '晚上读了一章灯塔'),
    row('exp_r', '2026-11-11T10:00:00.000Z', '我好像很怕让别人失望', { refs: ['exp_hurt'] })
  ])
  // 11-12 封存；11-11 20:00 才把两件事连起来——都在 as-of 的不同侧，用来区分"那时的样子"
  put(dir, 'seal-events.jsonl', [{ id: 'exp_hurt', at: '2026-11-12T12:00:00.000Z', day: '2026-11-12', action: 'seal', note: '' }])
  put(dir, 'link-events.jsonl', [{ from: 'exp_ok', to: 'exp_hurt', at: '2026-11-11T20:00:00.000Z', day: '2026-11-11', reason: '同一个店长' }])
}

test('as-of 早于封存：那时的书照收那件事并标「后来封存了」，不报现在封存了几件', (t) => {
  const dir = tmp(t); library(dir)
  const md = renderBook(dir, { asOf: '2026-11-11T15:00:00.000Z' })
  assert.match(md, /那天被当众批评，很难堪/)
  assert.match(md, /晚上读了一章灯塔/)
  assert.match(md, /这件事她后来封存了：2026-11-12/, '收进正文，但要标出是后来才封存的')
  assert.doesNotMatch(md, /有 \d+ 件她封存了的事没有收进来/, '历史导出不报现在的封存条数')
  // 别的条目引用它：那时它看得见，就写摘要，不写"（一件封存了的事）"
  assert.match(md, /是从这些事想到的：2026-11-10「那天被当众批评，很难堪」/)
  assert.doesNotMatch(md, /一件封存了的事/)
  // 那时还没连起来，就不提
  assert.doesNotMatch(md, /后来连在一起的/)
})

test('as-of 在连起来之后、封存之前：联想写另一头的摘要，不借封存吞掉', (t) => {
  const dir = tmp(t); library(dir)
  const md = renderBook(dir, { asOf: '2026-11-12T06:00:00.000Z' })
  assert.match(md, /后来连在一起的：/)
  assert.match(md, /晚上读了一章灯塔/)
  assert.match(md, /那天被当众批评，很难堪/)
  assert.match(md, /这件事她后来封存了/)
  assert.doesNotMatch(md, /undefined/, '另一头的理由当时就没留下，不能印出 undefined')
  assert.doesNotMatch(md, /一件封存了的事/)
  assert.doesNotMatch(md, /有 \d+ 件她封存了的事没有收进来/)
})

test('as-of 晚于封存：那天是封存着的，书里不收、计那一天的一件；includeSealed 才给正文和标记', (t) => {
  const dir = tmp(t); library(dir)
  const md = renderBook(dir, { asOf: '2026-11-13T20:00:00.000Z' })
  assert.doesNotMatch(md, /批评/)
  assert.match(md, /有 1 件她封存了的事没有收进来/)
  assert.match(md, /一件封存了的事/, '别的条目指过来，只说有这么一件')
  assert.match(md, /晚上读了一章灯塔/)

  const all = renderBook(dir, { asOf: '2026-11-13T20:00:00.000Z', includeSealed: true })
  assert.match(all, /那天被当众批评，很难堪/)
  assert.match(all, /这件事她封存了：2026-11-12/)
  assert.doesNotMatch(all, /后来封存了/, '那时就是这个状态，不是"后来"')
})

test('as-of 早于写下：那时还没有这条，书里也没有', (t) => {
  const dir = tmp(t); library(dir)
  const md = renderBook(dir, { asOf: '2026-11-10T23:00:00.000Z' })
  assert.match(md, /晚上读了一章灯塔/)
  assert.doesNotMatch(md, /很怕让别人失望/, '这条是 11-11 才写的')
})

test('现在这本书照旧：封存的不收、计数；解封之后再翻回那天又看得见', (t) => {
  const dir = tmp(t); library(dir)
  const now = renderBook(dir)
  assert.doesNotMatch(now, /批评/)
  assert.match(now, /有 1 件她封存了的事没有收进来/)

  put(dir, 'seal-events.jsonl', [
    { id: 'exp_hurt', at: '2026-11-12T12:00:00.000Z', day: '2026-11-12', action: 'seal', note: '' },
    { id: 'exp_hurt', at: '2026-11-14T12:00:00.000Z', day: '2026-11-14', action: 'unseal', note: '' }
  ])
  assert.match(renderBook(dir), /那天被当众批评，很难堪/, '现在解封了，现在的书就收')
  const sealedThen = renderBook(dir, { asOf: '2026-11-13T20:00:00.000Z' })
  assert.doesNotMatch(sealedThen, /批评/, '那天还封存着，那天的书照实不收')
  assert.match(sealedThen, /有 1 件她封存了的事没有收进来/)
})