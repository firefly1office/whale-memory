// 0.12：翻回那天的自己（asOf）、后来的感觉（later.feeling）、回想的出处（then.refs）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as bridge from '../packages/core/lib/evidence-from-experience.js'
import { parseAsOf } from '../packages/core/lib/as-of.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-012-'))
  t.after(() => safeRemove(dir))
  return dir
}
const memOf = (data) => path.join(data, 'plugin-data', 'biomimetic-memory')
const put = (dir, name, rows) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n') }
const add = (dir, name, row) => fs.appendFileSync(path.join(dir, name), JSON.stringify(row) + '\n')

// 固定时间线：第 1 天写下，第 2 天改主意、结案、被想起，第 3 天写一条回想
const D1 = '2026-11-14T13:00:00.000Z', D2 = '2026-11-15T13:00:00.000Z', D3 = '2026-11-16T13:00:00.000Z'
function timeline(dir) {
  const base = { author: 'self', source: 'own-time', kind: '读书', weight: 'normal', later: [], status: 'kept' }
  put(dir, 'self-experience.jsonl', [
    { ...base, id: 'exp_a', at: D1, day: '2026-11-14', then: { text: '读完灯塔故事的上半篇', scene: '', feeling: ['闷'], thought: '她是在等人回来吧', unfinished: '想知道船有没有回来', quote: null, state: { at: D1 } } },
    { ...base, id: 'exp_r', at: D3, day: '2026-11-16', kind: '回想', then: { text: '等待的人不一定是在怕黑', scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: { at: D3 }, refs: ['exp_a'] } }
  ])
  put(dir, 'later-events.jsonl', [{ id: 'exp_a', at: D2, day: '2026-11-15', thought: '读完结尾了，船回来了', reason: '', feeling: ['松了口气'] }])
  put(dir, 'unfinished-events.jsonl', [{ id: 'exp_a', at: D2, day: '2026-11-15', choice: 'done', note: '' }])
  put(dir, 'recall-events.jsonl', [{ id: 'exp_a', at: D1, query: '' }, { id: 'exp_a', at: D2, query: '' }])
}

test('翻回那天：那之后的后记、结案、想起、回想一律看不见；当时的正文不变', (t) => {
  const dir = tmp(t); timeline(dir)
  const cut = '2026-11-14T20:00:00.000Z'
  const past = exp.currentView(dir, 'exp_a', { asOf: cut })
  assert.equal(past.then.text, '读完灯塔故事的上半篇')
  assert.equal(past.later.length, 0)
  assert.equal(past.unfinishedState, undefined)
  assert.equal(past.recalls, 1, '只数那之前的一次想起')
  assert.equal(past.citedBy, undefined, '回想是第 3 天写的，那时还没有')
  assert.equal(exp.loadAll(dir, { asOf: cut }).length, 1)
  assert.equal(exp.currentView(dir, 'exp_r', { asOf: cut }), null, '那时还没写下的经历不存在')

  const text = exp.renderTwoPart(past)
  assert.match(text, /【那时（截至 2026-11-1[45] \d{2}:\d{2}）】/)
  assert.doesNotMatch(text, /船回来了|想通了|现在时间/)

  const now = exp.currentView(dir, 'exp_a')
  assert.equal(now.later.length, 1)
  assert.equal(now.unfinishedState.choice, 'done')
  assert.equal(now.recalls, 2)
})

test('翻回那天：只写日期时，截到那天本地时间的最后一刻，当天写下的都算', (t) => {
  const dir = tmp(t); timeline(dir)
  const day2 = new Date(D2).toLocaleDateString('sv-SE')
  const view = exp.currentView(dir, 'exp_a', { asOf: day2 })
  assert.equal(view.later.length, 1)
  assert.equal(view.unfinishedState.choice, 'done')
  assert.match(exp.renderTwoPart(view), new RegExp('【那时（截至 ' + day2 + '）】'))
  assert.throws(() => parseAsOf('2026-02-30'), /日期不存在/)
  assert.throws(() => parseAsOf('2026-02-30'), /as-of date does not exist: 2026-02-30/)
  assert.throws(() => parseAsOf('上周二'), /看不懂/)
})

test('翻回那天：召回只在那时的自己里找，而且不能顺手记一次想起', (t) => {
  const dir = tmp(t); timeline(dir)
  assert.equal(exp.recall(dir, '结尾', { asOf: '2026-11-14T20:00:00.000Z' }).length, 0, '后记是第 2 天才写的')
  assert.equal(exp.recall(dir, '结尾').length, 1)
  const before = fs.readFileSync(path.join(dir, 'recall-events.jsonl'), 'utf8')
  assert.throws(() => exp.recall(dir, '灯塔', { asOf: D2, mark: true }), /mark 和 asOf 不能一起用/)
  assert.equal(fs.readFileSync(path.join(dir, 'recall-events.jsonl'), 'utf8'), before)
})

test('后来的感觉：写进后记事件，当时的感觉不动；能被召回；翻读里各说各的', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '读完灯塔那一章', feeling: ['闷', '有点酸'] })
  const res = exp.reviseExperience(dir, { id: row.id, thought: '现在觉得她是在等船', feeling: '释然，有点想笑，释然' })
  assert.equal(res.ok, true)
  assert.deepEqual(res.feeling, ['释然', '有点想笑'], '逗号分隔、去重')
  const raw = fs.readFileSync(path.join(dir, 'later-events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(raw[0].feeling, ['释然', '有点想笑'])

  const view = exp.currentView(dir, row.id)
  assert.deepEqual(view.then.feeling, ['闷', '有点酸'])
  const text = exp.renderTwoPart(view)
  assert.match(text, /当时的感觉：闷、有点酸/)
  assert.match(text, /后来再想起的感觉：释然、有点想笑（\d{4}-\d{2}-\d{2}）/)
  assert.equal(exp.recall(dir, '释然')[0].id, row.id)

  // 没写感觉的后记不会冒充"后来的感觉"
  exp.reviseExperience(dir, { id: row.id, thought: '又读了一遍' })
  assert.match(exp.renderTwoPart(exp.currentView(dir, row.id)), /后来再想起的感觉：释然、有点想笑/)
})

test('当时的感觉：和后记同一套——逗号分隔的字符串也拆开、去重', (t) => {
  const dir = tmp(t)
  assert.deepEqual(exp.addExperience(dir, { text: '一', feeling: '闷，有点酸、闷' }).then.feeling, ['闷', '有点酸'])
  assert.deepEqual(exp.addExperience(dir, { text: '二', feeling: ['闷', ' 闷 ', ''] }).then.feeling, ['闷'])
  assert.throws(() => exp.addExperience(dir, { text: '三', feeling: Array.from({ length: 9 }, (_, i) => '词' + i) }), /最多 8 个/)
  assert.equal(exp.loadAll(dir).length, 2, '超了就整条不写')
})

test('后来的感觉：太多、太长都拒绝，什么都不写', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '灯塔' })
  assert.equal(exp.reviseExperience(dir, { id: row.id, thought: 'x', feeling: Array.from({ length: 9 }, (_, i) => '感觉' + i) }).ok, false)
  assert.equal(exp.reviseExperience(dir, { id: row.id, thought: 'x', feeling: ['长'.repeat(21)] }).ok, false)
  assert.equal(fs.existsSync(path.join(dir, 'later-events.jsonl')), false)
})

test('感觉的证据链：按时间问"那时对这件事什么感觉"，后来的感觉取代当时的，链条可查', (t) => {
  const dir = tmp(t); timeline(dir)
  const rows = exp.loadAll(dir)
  const early = bridge.ask(rows, { slot: 'feeling:exp_a', at: '2026-11-14T20:00:00.000Z' })
  assert.equal(early.status, 'known')
  assert.equal(early.value, '闷')
  const late = bridge.ask(rows, { slot: 'feeling:exp_a', at: D3 })
  assert.equal(late.value, '松了口气')
  assert.deepEqual(late.evidence.map((f) => f.value), ['闷', '松了口气'])
  assert.equal(bridge.ask(rows, { slot: 'feeling:exp_a', at: '2026-11-01T00:00:00.000Z' }).status, 'unknown', '还没写下时不知道，不猜')
})

test('出处：引用不存在的经历整条拒绝；旧 id 认回当前 id；重复去重；超过上限拒绝', (t) => {
  const dir = tmp(t)
  put(dir, 'self-experience.jsonl', [{ at: '2026-05-10T10:00:05Z', text: '升级前的旧经历' }])
  const a = exp.addExperience(dir, { text: '新的一条' })
  const before = fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')
  assert.throws(() => exp.addExperience(dir, { text: '回想', refs: ['exp_nope'] }), /找不到的经历：exp_nope/)
  assert.throws(() => exp.addExperience(dir, { text: '回想', refs: Array.from({ length: 9 }, () => a.id + 'x') }), /最多 8 条/)
  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8'), before, '拒绝时一个字节都不写')

  const legacy = exp.loadAll(dir).find((r) => r.legacy)
  const r = exp.addExperience(dir, { text: '回想', refs: `${a.id}, exp_legacy_202605101000, ${a.id}` })
  assert.deepEqual(r.then.refs, [a.id, legacy.id], '旧 id 落到当前 id，重复的只留一个')
})

test('出处：旧 id 有歧义就拒绝，不替她挑', (t) => {
  const dir = tmp(t)
  put(dir, 'self-experience.jsonl', [
    { at: '2026-05-10T10:00:05Z', text: '同一分钟第一条' },
    { at: '2026-05-10T10:00:40Z', text: '同一分钟第二条' }
  ])
  assert.throws(() => exp.addExperience(dir, { text: '回想', refs: ['exp_legacy_202605101000'] }), /几条经历共用/)
})

test('出处：翻读两头都看得见；找不到的出处如实标出来', (t) => {
  const dir = tmp(t); timeline(dir)
  const echo = exp.currentView(dir, 'exp_r')
  assert.match(exp.renderTwoPart(echo), /是从这几件事想到的：2026-11-14「读完灯塔故事的上半篇」/)
  const target = exp.currentView(dir, 'exp_a')
  assert.deepEqual(target.citedBy.map((c) => c.id), ['exp_r'])
  assert.match(exp.renderTwoPart(target), /后来有 1 条回想提到它：2026-11-16「等待的人不一定是在怕黑」/)

  // 只恢复了一部分文件：出处指向的经历不在了
  add(dir, 'self-experience.jsonl', { id: 'exp_orphan', at: D3, day: '2026-11-16', author: 'self', source: 'own-time', kind: '回想', weight: 'normal', later: [], status: 'kept', then: { text: '孤零零的回想', feeling: [], thought: '', unfinished: '', quote: null, refs: ['exp_gone'] } })
  const orphan = exp.currentView(dir, 'exp_orphan')
  assert.deepEqual(orphan.refsInfo, [{ id: 'exp_gone', missing: true }])
  assert.match(exp.renderTwoPart(orphan), /（exp_gone，找不到了）/)
})

for (const script of CLIS) {
  test('CLI：--refs / --feeling / read --id --as-of / recall --as-of / doctor 出处完整（' + script + '）', (t) => {
    const data = tmp(t)
    const run = (args) => {
      const res = spawnSync(process.execPath, [path.join(root, script), ...args, '--data', data], { encoding: 'utf8' })
      return { code: res.status, json: JSON.parse(res.stdout) }
    }
    timeline(memOf(data))
    const w = run(['write', '--text', '第四天又想起灯塔', '--refs', 'exp_a,exp_r'])
    assert.equal(w.code, 0)
    assert.deepEqual(w.json.refs, ['exp_a', 'exp_r'])
    assert.equal(run(['write', '--text', 'x', '--refs', 'exp_nope']).code, 1)

    const r = run(['revise', '--id', 'exp_a', '--thought', '再读一遍还是想哭', '--feeling', '想哭'])
    assert.deepEqual(r.json.feeling, ['想哭'])

    const now = run(['read', '--id', 'exp_a']).json.items[0]
    assert.deepEqual(now.feeling, ['闷'])
    assert.deepEqual(now.feelingNow, ['想哭'])
    assert.deepEqual(now.citedBy.sort(), [w.json.id, 'exp_r'].sort())
    assert.match(now.view, /后来再想起的感觉：想哭/)

    const past = run(['read', '--id', 'exp_a', '--as-of', '2026-11-14T20:00:00.000Z']).json
    assert.equal(past.asOf, '2026-11-14T20:00:00.000Z')
    assert.equal(past.items[0].later.length, 0)
    assert.match(past.items[0].view, /【那时（截至/)
    assert.equal(run(['read', '--id', 'exp_r', '--as-of', '2026-11-14T20:00:00.000Z']).json.items.length, 0)

    assert.equal(run(['recall', '--query', '结尾', '--as-of', '2026-11-14T20:00:00.000Z']).json.items.length, 0)
    assert.equal(run(['recall', '--query', '结尾']).json.items.length, 1)

    const doc = run(['doctor']).json
    assert.equal(doc.ok, true, JSON.stringify(doc.checks))
    add(memOf(data), 'self-experience.jsonl', { id: 'exp_orphan', at: D3, day: '2026-11-16', author: 'self', source: 'own-time', kind: '回想', weight: 'normal', later: [], status: 'kept', then: { text: '孤零零的回想', feeling: [], thought: '', unfinished: '', quote: null, refs: ['exp_gone'] } })
    const bad = run(['doctor']).json
    assert.equal(bad.ok, false)
    assert.equal(bad.checks.find((c) => c.name === '出处完整').ok, false)
  })
}
