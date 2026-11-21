// 0.13：她选择的遗忘（封存 / 解封）、回顾材料（recap）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as waking from '../packages/core/lib/waking.js'
import * as mem from '../packages/core/lib/self-memory.js'
import * as sealEvents from '../packages/core/lib/seal-events.js'
import { recap, renderRecap } from '../packages/core/lib/recap.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-013-'))
  t.after(() => safeRemove(dir))
  return dir
}
const memOf = (data) => path.join(data, 'plugin-data', 'biomimetic-memory')
const put = (dir, name, rows) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n') }
const base = { author: 'self', source: 'own-time', kind: '其它', weight: 'normal', later: [], status: 'kept' }
const row = (id, at, text, extra = {}) => ({ ...base, id, at, day: new Date(at).toLocaleDateString('sv-SE'), then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: { at }, ...extra } })

test('封存：不被召回、不进醒来块、不进 memory，但原文和后记都还在；解封就回来', (t) => {
  const data = tmp(t)
  const dir = memOf(data)
  const yesterday = new Date(Date.now() - 86400000)
  put(dir, 'self-experience.jsonl', [
    row('exp_hurt', yesterday.toISOString(), '那天被当众批评，很难堪', { feeling: ['难堪'], unfinished: '想知道是不是我做错了' }),
    row('exp_ok', yesterday.toISOString(), '读完灯塔故事', { unfinished: '想知道船有没有回来' })
  ])
  exp.reviseExperience(dir, { id: 'exp_hurt', thought: '还是会想起' })
  const before = fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')

  const res = exp.setSealed(dir, { id: 'exp_hurt', sealed: true, note: '不想再被提起' })
  assert.equal(res.ok, true)
  assert.equal(res.noop, false)
  assert.equal(exp.setSealed(dir, { id: 'exp_hurt', sealed: true }).noop, true, '重复封存不写第二条')

  assert.deepEqual(exp.recall(dir, '批评').map((r) => r.id), [])
  assert.deepEqual(exp.recall(dir, '批评', { includeSealed: true }).map((r) => r.id), ['exp_hurt'])
  assert.deepEqual(mem.recall(dir, '批评'), [])
  const block = waking.buildWakingBlock(data, 'local:owner', { now: new Date() })
  assert.doesNotMatch(block, /批评|是不是我做错了/)
  assert.match(block, /读完灯塔故事/)
  assert.match(block, /你还没弄完：想知道船有没有回来/)

  const view = exp.currentView(dir, 'exp_hurt')
  assert.equal(view.then.text, '那天被当众批评，很难堪')
  assert.equal(view.later.length, 1)
  assert.equal(view.sealed.note, '不想再被提起')
  assert.match(exp.renderTwoPart(view), /这件事你封存了（\d{4}-\d{2}-\d{2}）/)
  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8'), before, '封存不动经历文件')

  assert.equal(exp.setSealed(dir, { id: 'exp_hurt', sealed: false }).noop, false)
  assert.equal(exp.setSealed(dir, { id: 'exp_hurt', sealed: false }).noop, true, '没封存的解封是空操作')
  assert.deepEqual(exp.recall(dir, '批评').map((r) => r.id), ['exp_hurt'])
  assert.equal(exp.currentView(dir, 'exp_hurt').sealed, undefined)
})

test('封存：别的回想引用它时不露摘要；翻回封存之前也不翻出来（0.17 起），点名读写明是后来封存的', (t) => {
  const dir = tmp(t)
  put(dir, 'self-experience.jsonl', [
    row('exp_hurt', '2026-11-10T12:00:00.000Z', '那天被当众批评，很难堪'),
    row('exp_r', '2026-11-11T12:00:00.000Z', '我好像很怕让别人失望', { refs: ['exp_hurt'] })
  ])
  put(dir, 'seal-events.jsonl', [{ id: 'exp_hurt', at: '2026-11-12T12:00:00.000Z', day: '2026-11-12', action: 'seal', note: '' }])

  const echo = exp.currentView(dir, 'exp_r')
  assert.deepEqual(echo.refsInfo, [{ id: 'exp_hurt', day: '2026-11-10', sealed: true }])
  const text = exp.renderTwoPart(echo)
  assert.match(text, /是从这几件事想到的：（一件你封存了的事）/)
  assert.doesNotMatch(text, /批评/)

  // 0.17：翻回封存之前，那时还没封存，但她现在封存着——照样不翻出来；点名读给，并写明是后来封存的
  const asOf = '2026-11-11T20:00:00.000Z'
  const then = exp.currentView(dir, 'exp_hurt', { asOf })
  assert.equal(then.sealed.afterAsOf, true, '后来才封存的')
  assert.match(exp.renderTwoPart(then), /这件事你后来封存了（2026-11-12）/)
  assert.equal(exp.recall(dir, '批评', { asOf }).length, 0, '翻回那天也想不起她现在封存着的')
  assert.deepEqual(exp.currentView(dir, 'exp_r', { asOf }).refsInfo, [{ id: 'exp_hurt', day: '2026-11-10', sealed: true }], '引用它的回想也不露摘要')
  assert.ok(exp.loadAll(dir, { asOf }).find((r) => r.id === 'exp_hurt').sealed, '列表过滤照常生效')

  // 解封之后，翻回那天又能看到了
  exp.setSealed(dir, { id: 'exp_hurt', sealed: false })
  assert.equal(exp.currentView(dir, 'exp_hurt', { asOf }).sealed, undefined)
  assert.equal(exp.recall(dir, '批评', { asOf }).length, 1)

  // 那时封存着、现在已经解封：那天的样子照实，仍是封存着的
  const old = exp.currentView(dir, 'exp_hurt', { asOf: '2026-11-12T20:00:00.000Z' })
  assert.equal(old.sealed.day, '2026-11-12')
  assert.equal(old.sealed.afterAsOf, undefined)
})

test('封存：找不到的 id、歧义旧 id 都拒绝，什么都不写；并发同一封存只记一次', async (t) => {
  const dir = tmp(t)
  put(dir, 'self-experience.jsonl', [
    { at: '2026-05-10T10:00:05Z', text: '同一分钟第一条' },
    { at: '2026-05-10T10:00:40Z', text: '同一分钟第二条' },
    row('exp_a', '2026-11-10T12:00:00.000Z', '一条普通的经历')
  ])
  assert.equal(exp.setSealed(dir, { id: 'exp_nope' }).ok, false)
  assert.match(exp.setSealed(dir, { id: 'exp_legacy_202605101000' }).error, /好几条旧经历共用/)
  assert.equal(fs.existsSync(path.join(dir, 'seal-events.jsonl')), false)

  // 两个进程同时提交同一封存
  const worker = path.join(dir, 'seal-worker.mjs')
  fs.writeFileSync(worker, `import * as exp from ${JSON.stringify(new URL('../packages/core/lib/self-experience.js', import.meta.url).href)}\nconst r = exp.setSealed(process.argv[2], { id: 'exp_a' })\nprocess.exit(r.ok ? 0 : 1)\n`)
  await Promise.all([0, 1, 2].map(() => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [worker, dir], { stdio: 'ignore' })
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker ' + code))))
  })))
  assert.equal(sealEvents.readAll(dir).rows.length, 1)
})

test('回顾：只列这几天的事实，封存的不列；按自然日计；每条都带 id 方便写出处', (t) => {
  const dir = tmp(t)
  const now = new Date(2026, 10, 16, 21, 0, 0)
  const at = (d, h = 12) => new Date(2026, 10, d, h, 0, 0).toISOString()
  put(dir, 'self-experience.jsonl', [
    row('exp_old', at(1), '很早以前的事', { unfinished: '一直没想明白的事' }),
    row('exp_book', at(14), '读完灯塔故事的上半篇', { feeling: ['闷'], unfinished: '想知道船有没有回来' }),
    row('exp_hurt', at(15), '那天被当众批评'),
    { ...row('exp_r', at(16), '等待的人不一定是在怕黑', { refs: ['exp_book'] }), kind: '回想' }
  ])
  put(dir, 'later-events.jsonl', [
    { id: 'exp_book', at: at(15), day: '2026-11-15', thought: '读完结尾了，船回来了', reason: '', feeling: ['释然'] },
    { id: 'exp_old', at: at(2), day: '2026-11-02', thought: '太早了，不该出现在这周', reason: '' }
  ])
  put(dir, 'unfinished-events.jsonl', [{ id: 'exp_book', at: at(15, 13), day: '2026-11-15', choice: 'done', note: '' }])
  put(dir, 'seal-events.jsonl', [{ id: 'exp_hurt', at: at(15, 14), day: '2026-11-15', action: 'seal', note: '' }])

  const rc = recap(dir, { days: 7, now })
  assert.equal(rc.from, '2026-11-10')
  assert.equal(rc.to, '2026-11-16')
  assert.deepEqual(rc.written.map((x) => x.id), ['exp_book', 'exp_r'], '封存的和七天以前的都不列')
  assert.deepEqual(rc.revised.map((x) => x.id), ['exp_book'])
  assert.deepEqual(rc.feelingShifts, [{ id: 'exp_book', day: '2026-11-14', text: '读完灯塔故事的上半篇', then: ['闷'], now: ['释然'], laterDay: '2026-11-15' }])
  assert.deepEqual(rc.settled.map((x) => [x.id, x.choice]), [['exp_book', 'done']])
  assert.deepEqual(rc.stillOpen.map((x) => x.id), ['exp_old'], '想通了的不算还没弄完')

  const text = renderRecap(rc)
  assert.match(text, /【这几天（2026-11-10 ~ 2026-11-16）】/)
  assert.match(text, /（exp_book）/)
  assert.match(text, /「等待的人不一定是在怕黑」（exp_r）（这是一条回想）/)
  assert.match(text, /当时 闷 → 2026-11-15 释然/)
  assert.match(text, /「想知道船有没有回来」想通了/)
  assert.doesNotMatch(text, /批评|太早了/)
  assert.match(text, /不是结论/)

  assert.throws(() => recap(dir, { days: 0 }), /1 到 366/)
  const earlier = recap(dir, { days: 3, asOf: '2026-11-14T23:00:00+08:00' })
  assert.deepEqual(earlier.written.map((x) => x.id), ['exp_book'])
  assert.equal(earlier.revised.length, 0, '那时还没回头想过')
})

for (const script of CLIS) {
  test('CLI：seal / unseal / read 默认不列封存 / recap（' + script + '）', (t) => {
    const data = tmp(t)
    const run = (args) => {
      const r = spawnSync(process.execPath, [path.join(root, script), ...args, '--data', data], { encoding: 'utf8' })
      return { code: r.status, json: JSON.parse(r.stdout) }
    }
    const a = run(['write', '--text', '那天被当众批评，很难堪']).json.id
    run(['write', '--text', '读完灯塔故事'])
    assert.equal(run(['seal', '--id', a, '--note', '不想再被提起']).json.sealed, true)
    const list = run(['read']).json
    assert.deepEqual(list.items.map((i) => i.text), ['读完灯塔故事'])
    assert.equal(list.sealedHidden, 1)
    assert.equal(run(['read', '--sealed', 'true']).json.items.length, 2)
    assert.equal(run(['read', '--id', a]).json.items[0].sealed.note, '不想再被提起')
    assert.equal(run(['recall', '--query', '批评']).json.items.length, 0)
    assert.equal(run(['recall', '--query', '批评', '--sealed', 'true']).json.items[0].sealed, true)

    const rc = run(['recap', '--days', '1']).json
    assert.equal(rc.ok, true)
    assert.deepEqual(rc.recap.written.map((x) => x.text), ['读完灯塔故事'])
    assert.match(rc.text, /【这几天/)

    assert.equal(run(['unseal', '--id', a]).json.noop, false)
    assert.equal(run(['recall', '--query', '批评']).json.items.length, 1)
    assert.equal(run(['seal', '--id', 'exp_nope']).code, 1)
    assert.equal(run(['doctor']).json.ok, true)
  })

  test('CLI：封存跟着导出包走，换个目录导入后仍是封存（' + script + '）', (t) => {
    const a = tmp(t), b = tmp(t), outDir = tmp(t)
    const run = (data, args) => JSON.parse(spawnSync(process.execPath, [path.join(root, script), ...args, '--data', data], { encoding: 'utf8' }).stdout)
    const id = run(a, ['write', '--text', '那天被当众批评，很难堪']).id
    run(a, ['seal', '--id', id])
    const exported = run(a, ['export', '--out', outDir])
    assert.equal(exported.ok, true)
    assert.equal(run(b, ['import', '--from', exported.dir]).ok, true)
    assert.equal(run(b, ['recall', '--query', '批评']).items.length, 0, '新机器上也不该被召回')
    assert.ok(run(b, ['read', '--id', id]).items[0].sealed)
  })
}

test('封存（0.17）：翻回封存之前导出的书、回顾，也不收她现在封存着的', async (t) => {
  const { renderBook } = await import('../packages/core/lib/book.js')
  const dir = tmp(t)
  put(dir, 'self-experience.jsonl', [
    row('exp_hurt', '2026-11-10T12:00:00.000Z', '那天被当众批评，很难堪'),
    row('exp_ok', '2026-11-10T13:00:00.000Z', '晚上读了一章灯塔')
  ])
  put(dir, 'seal-events.jsonl', [{ id: 'exp_hurt', at: '2026-11-12T12:00:00.000Z', day: '2026-11-12', action: 'seal', note: '' }])
  const asOf = '2026-11-11T20:00:00.000Z'
  const md = renderBook(dir, { asOf })
  assert.doesNotMatch(md, /批评/)
  assert.match(md, /灯塔/)
  assert.match(md, /有 1 件她封存了的事没有收进来/)
  assert.doesNotMatch(renderRecap(recap(dir, { days: 7, asOf, now: new Date('2026-11-11T20:00:00.000Z') })), /批评/)
})
