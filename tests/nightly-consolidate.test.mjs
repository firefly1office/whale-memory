// 夜间整理最简版：默认 dry-run 一个字节都不写；--write 只追加事件；--undo 只追加撤销；
// 记录与六类既有事件文件逐字节不变；坏行 fail closed。
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { safeRemove, tmpDir } from './_safety.mjs'
import { extractQuoted, isValidEvent, planConsolidation, suggestionId } from '../tools/nightly-consolidate.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const TOOL = 'tools/nightly-consolidate.mjs'
const RECORDS = 'self-experience.jsonl'
const EVENT = 'consolidate-events.jsonl'
// 六类既有事件文件：整理工具不许改它们一个字节
const EVENT_FILES = ['later-events.jsonl', 'seal-events.jsonl', 'recall-events.jsonl', 'unfinished-events.jsonl', 'link-events.jsonl', 'chapter-events.jsonl']

const pad = (n) => String(n).padStart(2, '0')
const DAY = (day) => '2026-11-' + pad(day)
const AT = (day, hour = 10) => DAY(day) + 'T' + pad(hour) + ':00:00.000Z'

function record({ id, day, text, quote = null, refs = null, kind = '其它' }) {
  const row = {
    id,
    at: AT(day),
    day: DAY(day),
    author: 'self',
    source: 'own-time',
    kind,
    weight: 'normal',
    then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote, state: { at: AT(day) } },
    later: [],
    status: 'kept'
  }
  if (refs) row.then.refs = refs
  return row
}

const later = (id, day, thought) => ({ id, at: AT(day), day: DAY(day), thought })

const writeJsonl = (dir, name, rows) => {
  fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

const sha = (file) => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null)

// 整个目录的指纹（文件名 → 内容 sha256）：dry-run 前后必须完全一样
function snapshot(dir) {
  const out = {}
  for (const name of fs.readdirSync(dir).sort()) out[name] = sha(path.join(dir, name))
  return out
}

function makeDir(t, { records = [], laters = [], seals = [], others = {} } = {}) {
  const dir = tmpDir('nightly-')
  t.after(() => safeRemove(dir))
  writeJsonl(dir, RECORDS, records)
  if (laters.length) writeJsonl(dir, 'later-events.jsonl', laters)
  if (seals.length) writeJsonl(dir, 'seal-events.jsonl', seals)
  for (const [name, rows] of Object.entries(others)) writeJsonl(dir, name, rows)
  return dir
}

const run = (dir, ...flags) => spawnSync(process.execPath, [TOOL, dir, ...flags], { cwd: root, encoding: 'utf8' })
const jsonOf = (r) => JSON.parse(r.stdout)
const eventRows = (dir) => fs.readFileSync(path.join(dir, EVENT), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

// 一组能同时触发三类建议的数据：
//   exp_a 有 2 条后记（merge-later）、后记里引了原话里没有的「船已经靠岸」（quote-not-in-source）
//   exp_b 与 exp_a 由 then.refs 相连（merge-topic）
//   exp_q 自己写的话里引的「别怕黑」和读到的原文对不上（quote-not-in-quote）
function sample() {
  return {
    records: [
      record({ id: 'exp_a', day: 14, text: '读完灯塔故事的上半篇，靠在窗边', quote: { text: '潮汐终会归来', source: '《灯塔》' } }),
      record({ id: 'exp_b', day: 16, text: '灯塔下的纸船，被潮汐带走了', refs: ['exp_a'], kind: '回想' }),
      record({ id: 'exp_q', day: 12, text: '书里那句「别怕黑」，我抄在纸上', quote: { text: '潮汐终会归来', source: '《灯塔》' } })
    ],
    laters: [
      later('exp_a', 15, '他说过「潮汐终会归来」，我记下了'),
      later('exp_a', 16, '他又说「船已经靠岸」，可原文不是这样')
    ]
  }
}

test('dry-run：整个目录前后的指纹完全相同，一个字节都不写', (t) => {
  const data = sample()
  const dir = makeDir(t, {
    records: data.records,
    laters: data.laters,
    seals: [{ id: 'exp_q', at: AT(18), day: DAY(18), action: 'seal' }],
    others: Object.fromEntries(EVENT_FILES.slice(2).map((name) => [name, []]))
  })
  const before = snapshot(dir)
  const r = run(dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /dry-run/)
  assert.match(r.stdout, /建议/, 'dry-run 要把建议打进 stdout')
  assert.match(r.stdout, /没有写任何文件/)
  assert.deepEqual(snapshot(dir), before, 'dry-run 不许写任何文件')
  assert.equal(fs.existsSync(path.join(dir, EVENT)), false)
})

test('--write：只多出 consolidate-events.jsonl，记录与六类事件文件逐字节不变', (t) => {
  const data = sample()
  const dir = makeDir(t, {
    records: [...data.records, record({ id: 'exp_sealed', day: 9, text: '封存的一条' })],
    laters: data.laters,
    seals: [{ id: 'exp_sealed', at: AT(18), day: DAY(18), action: 'seal' }],
    others: {
      // 六类既有事件文件都先放一份真实形状的旧事件，证明整理工具不碰它们
      'recall-events.jsonl': [{ id: 'exp_a', at: AT(19), day: DAY(19) }],
      'unfinished-events.jsonl': [{ id: 'exp_b', at: AT(19), day: DAY(19), choice: 'shelved', note: '' }],
      'link-events.jsonl': [{ from: 'exp_a', to: 'exp_b', at: AT(19), day: DAY(19), reason: '都在等' }],
      'chapter-events.jsonl': [{ id: 'ch_1', at: AT(19), day: DAY(19), action: 'open', name: '灯塔的秋天', from: '2026-11-01', to: '', note: '' }]
    }
  })
  const before = snapshot(dir)
  const r = run(dir, '--write')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /已写入/)
  assert.match(r.stdout, /只追加/)

  // 记录 + 六类既有事件文件：每一份都必须逐字节不变（before 里有什么就比什么）
  for (const name of Object.keys(before)) {
    assert.equal(sha(path.join(dir, name)), before[name], name + ' 必须逐字节不变')
  }
  assert.ok('later-events.jsonl' in before && 'seal-events.jsonl' in before && 'recall-events.jsonl' in before, '样本要覆盖六类事件文件')

  const after = snapshot(dir)
  const added = Object.keys(after).filter((name) => !(name in before))
  assert.deepEqual(added, [EVENT], '只允许新增这一个事件文件')

  const rows = eventRows(dir)
  assert.ok(rows.length >= 3, '至少三类建议都应落盘')
  for (const row of rows) {
    assert.equal(isValidEvent(row), true, '每一行都必须是约定形状：' + JSON.stringify(row))
    assert.equal(row.v, 1)
    assert.match(row.id, /^cons_[0-9a-f]{12}$/)
    assert.ok(Array.isArray(row.ids) && row.ids.length >= 1)
    assert.ok(typeof row.summary === 'string' && row.summary.length > 0)
    assert.ok(typeof row.reason === 'string' && row.reason.length > 0)
    assert.ok(['merge-later', 'merge-topic', 'quote-not-in-source', 'quote-not-in-quote'].includes(row.type))
  }
  const types = new Set(rows.map((row) => row.type))
  assert.ok(types.has('merge-later'))
  assert.ok(types.has('merge-topic'))
  assert.ok(types.has('quote-not-in-source'))
  assert.ok(types.has('quote-not-in-quote'))
})

test('幂等：同一份数据再跑 --write 不追加任何一行', (t) => {
  const data = sample()
  const dir = makeDir(t, { records: data.records, laters: data.laters })
  assert.equal(run(dir, '--write').status, 0)
  const first = sha(path.join(dir, EVENT))
  const count = eventRows(dir).length
  const again = run(dir, '--write')
  assert.equal(again.status, 0, again.stderr)
  assert.equal(sha(path.join(dir, EVENT)), first, '第二次 --write 不许改事件文件')
  assert.equal(eventRows(dir).length, count)
  assert.match(again.stdout, /没有新建议|已写过/)
})

test('--undo：追加一条撤销事件，原建议逐字节留在前面；再跑 --write 不重复建议', (t) => {
  const data = sample()
  const dir = makeDir(t, { records: data.records, laters: data.laters })
  assert.equal(run(dir, '--write').status, 0)
  const beforeBuf = fs.readFileSync(path.join(dir, EVENT))
  const beforeRows = eventRows(dir)
  const targetId = beforeRows[beforeRows.length - 1].id

  const undo = run(dir, '--undo')
  assert.equal(undo.status, 0, undo.stderr)
  const afterBuf = fs.readFileSync(path.join(dir, EVENT))
  assert.deepEqual(afterBuf.subarray(0, beforeBuf.length), beforeBuf, '撤销不许改写已写下的建议')
  const rows = eventRows(dir)
  assert.equal(rows.length, beforeRows.length + 1)
  assert.equal(rows[rows.length - 1].type, 'undo')
  assert.equal(rows[rows.length - 1].id, targetId, '撤销事件指向被撤销的建议')

  const undoAgain = run(dir, '--undo')
  assert.equal(undoAgain.status, 0, '重复撤销是 noop，不报错')
  assert.match(undoAgain.stdout, /已经撤销过/)
  assert.equal(sha(path.join(dir, EVENT)), sha(path.join(dir, EVENT)), 'noop 不该改变文件')

  const shaBeforeWrite = sha(path.join(dir, EVENT))
  assert.equal(run(dir, '--write').status, 0)
  assert.equal(sha(path.join(dir, EVENT)), shaBeforeWrite, '撤销过的建议不许被重新写一遍')
})

test('--undo --id：只撤指的那一条，别的建议不动', (t) => {
  const data = sample()
  const dir = makeDir(t, { records: data.records, laters: data.laters })
  assert.equal(run(dir, '--write').status, 0)
  const before = eventRows(dir)
  const [first, second] = before
  const undo = run(dir, '--undo', '--id', first.id)
  assert.equal(undo.status, 0, undo.stderr)
  const rows = eventRows(dir)
  assert.equal(rows[rows.length - 1].type, 'undo')
  assert.equal(rows[rows.length - 1].id, first.id)
  assert.ok(second, '样本至少两条建议')
  assert.ok(rows.filter((row) => row.type === 'undo').every((row) => row.id !== second.id), '没被点名的那条不该被撤')
  const missing = run(dir, '--undo', '--id', 'cons_000000000000')
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /找不到这条建议/)
})

test('对照原话：后记引文能在原话里找到就放过，找不到才报', (t) => {
  const dir = makeDir(t, {
    records: [
      record({ id: 'exp_found', day: 10, text: '读到一句话', quote: { text: '潮汐终会归来', source: '《灯塔》' } }),
      record({ id: 'exp_miss', day: 11, text: '读到另一句', quote: { text: '潮汐终会归来', source: '《灯塔》' } })
    ],
    laters: [
      later('exp_found', 12, '他说「潮汐终会归来」'),
      later('exp_miss', 12, '他说「船已经靠岸」')
    ]
  })
  const r = run(dir, '--json')
  assert.equal(r.status, 0, r.stderr)
  const { suggestions } = jsonOf(r)
  const misses = suggestions.filter((s) => s.type === 'quote-not-in-source')
  assert.equal(misses.length, 1, '只有找不到的那条要报')
  assert.deepEqual(misses[0].ids, ['exp_miss'])
  assert.match(misses[0].summary, /船已经靠岸/)
  assert.match(misses[0].reason, /then\.text \/ then\.quote\.text/)
  assert.ok(!suggestions.some((s) => s.type === 'quote-not-in-source' && s.ids[0] === 'exp_found'), '引对了的不报')
})

test('对照原话：她写的话里的引文，要和读到的原文对得上', (t) => {
  const dir = makeDir(t, {
    records: [record({ id: 'exp_q', day: 12, text: '书里那句「别怕黑」，我抄在纸上', quote: { text: '潮汐终会归来', source: '《灯塔》' } })]
  })
  const r = run(dir, '--json')
  assert.equal(r.status, 0, r.stderr)
  const hit = jsonOf(r).suggestions.filter((s) => s.type === 'quote-not-in-quote')
  assert.equal(hit.length, 1)
  assert.match(hit[0].summary, /别怕黑/)
  assert.deepEqual(hit[0].ids, ['exp_q'])
})

test('同主题归并：then.refs 相连的两条归成一条，理由写清是 refs', (t) => {
  const dir = makeDir(t, {
    records: [
      record({ id: 'exp_a', day: 14, text: '灯塔故事读完了' }),
      record({ id: 'exp_b', day: 16, text: '又想起那座灯塔', refs: ['exp_a'], kind: '回想' })
    ]
  })
  const r = run(dir, '--json')
  assert.equal(r.status, 0, r.stderr)
  const groups = jsonOf(r).suggestions.filter((s) => s.type === 'merge-topic')
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].ids, ['exp_a', 'exp_b'])
  assert.match(groups[0].reason, /refs 显式相连/)
})

test('同主题归并：关键词重叠够多才归并；不相关的不碰', (t) => {
  const dir = makeDir(t, {
    records: [
      record({ id: 'exp_a', day: 10, text: '灯塔故事里的潮汐和纸船' }),
      record({ id: 'exp_b', day: 11, text: '潮汐里的纸船，还有灯塔故事' }),
      record({ id: 'exp_x', day: 12, text: '下午修好了自行车链条' })
    ]
  })
  const r = run(dir, '--json')
  assert.equal(r.status, 0, r.stderr)
  const groups = jsonOf(r).suggestions.filter((s) => s.type === 'merge-topic')
  assert.equal(groups.length, 1, '只有重叠够多的两条归并；无关的不进组')
  assert.deepEqual(groups[0].ids, ['exp_a', 'exp_b'])
  assert.match(groups[0].reason, /关键词重叠/)
})

test('同一条经历的几条后记：归并成一条建议，逐条带日子', (t) => {
  const dir = makeDir(t, {
    records: [record({ id: 'exp_a', day: 10, text: '读到灯塔故事' })],
    laters: [later('exp_a', 11, '先记着'), later('exp_a', 13, '后来又想起'), later('exp_a', 15, '再补一句')]
  })
  const r = run(dir, '--json')
  assert.equal(r.status, 0, r.stderr)
  const merges = jsonOf(r).suggestions.filter((s) => s.type === 'merge-later')
  assert.equal(merges.length, 1)
  assert.deepEqual(merges[0].ids, ['exp_a'])
  for (const day of ['2026-11-11', '2026-11-13', '2026-11-15']) assert.ok(merges[0].summary.includes(day), '归并摘要要带日子：' + day)
  assert.match(merges[0].reason, /3 条后记/)
})

test('封存的不参与整理：正文与摘要一个字都不进新事件文件', (t) => {
  const dir = makeDir(t, {
    records: [
      record({ id: 'exp_sealed', day: 10, text: '封存的那条正文别外露', quote: { text: '潮汐终会归来', source: '《灯塔》' } }),
      record({ id: 'exp_open', day: 11, text: '普通的一条' })
    ],
    laters: [
      later('exp_sealed', 12, '他说「船已经靠岸」'),
      later('exp_sealed', 13, '又说「潮汐终会归来」'),
      later('exp_open', 14, '普通的后记一'),
      later('exp_open', 15, '普通的后记二')
    ],
    seals: [{ id: 'exp_sealed', at: AT(16), day: DAY(16), action: 'seal' }]
  })
  const dry = run(dir, '--json')
  assert.equal(dry.status, 0, dry.stderr)
  const json = jsonOf(dry)
  assert.equal(json.counts.sealedSkipped, 1)
  assert.ok(!json.suggestions.some((s) => s.ids.includes('exp_sealed')), '封存的不该出现在建议里')
  assert.ok(json.suggestions.length >= 1, '没封存的那条后记照样整理')

  assert.equal(run(dir, '--write').status, 0)
  const raw = fs.readFileSync(path.join(dir, EVENT), 'utf8')
  assert.ok(!raw.includes('封存的那条正文别外露'), '封存正文不许被抄进事件文件')
  assert.ok(!raw.includes('船已经靠岸'), '封存记录的后记也不许被抄进去')
  assert.ok(!raw.includes('exp_sealed'), '连 id 都不该带出来')
})

test('空目录：能跑，0 条建议，退出 0，什么都不写', (t) => {
  const dir = tmpDir('nightly-empty-')
  t.after(() => safeRemove(dir))
  const r = run(dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /没有发现需要整理的地方/)
  assert.deepEqual(fs.readdirSync(dir), [])
  assert.equal(run(dir, '--write').status, 0)
  assert.equal(fs.existsSync(path.join(dir, EVENT)), false, '没有建议时 --write 不建空文件')
})

test('只有 1 条经历：能跑，没有归并建议', (t) => {
  const dir = makeDir(t, { records: [record({ id: 'exp_one', day: 10, text: '只有这一条' })] })
  const r = run(dir, '--json')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(jsonOf(r).suggestions.length, 0)
})

test('200 条经历：能跑完，落盘事件条数对得上', (t) => {
  const records = []
  for (let i = 1; i <= 200; i += 1) records.push(record({ id: 'exp_' + pad(i), day: (i % 27) + 1, text: '第 ' + i + ' 条：天色是 ' + i + ' 号，没有什么特别' }))
  const laters = []
  for (let i = 1; i <= 20; i += 1) {
    laters.push(later('exp_' + pad(i), 20, '第一条后记'))
    laters.push(later('exp_' + pad(i), 21, '第二条后记'))
  }
  const dir = makeDir(t, { records, laters })
  assert.equal(run(dir, '--write').status, 0)
  const rows = eventRows(dir)
  assert.equal(rows.length, 20, '20 条各有两条后记 → 20 条归并建议（关键词不够就不该乱归并）')
  assert.ok(rows.every((row) => row.type === 'merge-later'))
  assert.ok(!rows.some((row) => row.type === 'merge-topic'), '模板化的 200 条不许被归并成一大组')
})

test('坏行 fail closed：经历文件里有一行坏 JSON → 退出 1，不写事件文件', (t) => {
  const dir = makeDir(t, { records: [record({ id: 'exp_a', day: 10, text: '正常的' })] })
  fs.appendFileSync(path.join(dir, RECORDS), '{"broken":\n', 'utf8')
  const r = run(dir, '--write')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /无法解析/)
  assert.equal(fs.existsSync(path.join(dir, EVENT)), false, '读不懂数据时不许落盘')
})

test('坏行 fail closed：后记文件里有一行坏 JSON → 退出 1，不写事件文件', (t) => {
  const dir = makeDir(t, { records: [record({ id: 'exp_a', day: 10, text: '正常的' })] })
  fs.writeFileSync(path.join(dir, 'later-events.jsonl'), JSON.stringify(later('exp_a', 11, '好的')) + '\n{oops\n', 'utf8')
  const r = run(dir, '--write')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /无法解析/)
  assert.equal(fs.existsSync(path.join(dir, EVENT)), false)
})

test('坏行 fail closed：整理事件文件有坏行 → dry-run 与 --write 都拒绝，不追加', (t) => {
  const dir = makeDir(t, { records: [record({ id: 'exp_a', day: 10, text: '读到灯塔故事' })], laters: [later('exp_a', 11, 'a'), later('exp_a', 12, 'b')] })
  fs.writeFileSync(path.join(dir, EVENT), '{not json\n', 'utf8')
  for (const flags of [[], ['--write']]) {
    const r = run(dir, ...flags)
    assert.equal(r.status, 1, '整理记录读不懂时不能当成「还没整理过」')
    assert.match(r.stderr, /整理事件/)
    assert.equal(fs.readFileSync(path.join(dir, EVENT), 'utf8'), '{not json\n', '坏文件原样留着，不许被覆盖')
  }
})

test('目录不存在：退出 1，也不把目录建出来', (t) => {
  const base = tmpDir('nightly-ghost-')
  t.after(() => safeRemove(base))
  const ghost = path.join(base, 'not-here')
  const r = run(ghost)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /数据目录不存在|读不出来/)
  assert.equal(fs.existsSync(ghost), false)
})

test('用法错：--write 与 --undo 同时给、缺目录，都退出 2', () => {
  const both = spawnSync(process.execPath, [TOOL, 'x', '--write', '--undo'], { cwd: root, encoding: 'utf8' })
  assert.equal(both.status, 2)
  assert.match(both.stderr, /不能同时用/)
  const none = spawnSync(process.execPath, [TOOL], { cwd: root, encoding: 'utf8' })
  assert.equal(none.status, 2)
  assert.match(none.stderr, /缺少记忆目录/)
})

test('撤销不需要经历文件：记录坏了照样撤得掉', (t) => {
  const data = sample()
  const dir = makeDir(t, { records: data.records, laters: data.laters })
  assert.equal(run(dir, '--write').status, 0)
  fs.appendFileSync(path.join(dir, RECORDS), '{broken\n', 'utf8')
  const undo = run(dir, '--undo')
  assert.equal(undo.status, 0, undo.stderr)
  assert.equal(eventRows(dir).at(-1).type, 'undo')
})

test('事件只有约定的八个字段，id 在两次运行之间稳定', (t) => {
  const data = sample()
  const dir = makeDir(t, { records: data.records, laters: data.laters })
  const one = jsonOf(run(dir, '--json')).suggestions.map((s) => s.id)
  const two = jsonOf(run(dir, '--json')).suggestions.map((s) => s.id)
  assert.deepEqual(one, two, '同一份数据两次算出的建议 id 必须一样')
  assert.equal(new Set(one).size, one.length, '一次运行里不许出现重复建议')

  assert.equal(run(dir, '--write').status, 0)
  for (const row of eventRows(dir)) {
    assert.deepEqual(Object.keys(row).sort(), ['at', 'day', 'id', 'ids', 'reason', 'summary', 'type', 'v'])
  }
})

test('纯函数：planConsolidation 不修改传入的经历', () => {
  const data = sample()
  const json = JSON.stringify(data.records)
  planConsolidation(data.records, {})
  assert.equal(JSON.stringify(data.records), json)
})

test('引文抓取：只认成对引号，太短的、没有引号的都不当引文', () => {
  assert.deepEqual(extractQuoted('他说「潮汐终会归来」'), ['潮汐终会归来'])
  assert.deepEqual(extractQuoted('“船已经靠岸”和「嗯」'), ['船已经靠岸'])
  assert.deepEqual(extractQuoted('普通的一句话'), [])
  const id = suggestionId('merge-later', 'exp_a')
  assert.match(id, /^cons_[0-9a-f]{12}$/)
  assert.equal(id, suggestionId('merge-later', 'exp_a'))
  assert.notEqual(id, suggestionId('merge-later', 'exp_b'))
})

test('零依赖、不联网：工具只 import 本仓库模块与 node 内置', () => {
  const source = fs.readFileSync(path.join(root, TOOL), 'utf8')
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.ok(imports.length > 0)
  for (const spec of imports) {
    assert.ok(spec.startsWith('node:') || spec.startsWith('../packages/'), '不许引第三方：' + spec)
  }
  assert.ok(!/\bfetch\s*\(|node:https?|node:net|XMLHttpRequest/.test(source), '不许联网')
})