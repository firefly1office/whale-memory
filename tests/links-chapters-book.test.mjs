// 0.14：事后联想（link）、人生章节（chapter）、她的书（book）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as linkEvents from '../packages/core/lib/link-events.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import { renderBook } from '../packages/core/lib/book.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-014-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const memOf = (data) => path.join(data, 'plugin-data', 'biomimetic-memory')
const put = (dir, name, rows) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n') }
const base = { author: 'self', source: 'own-time', kind: '其它', weight: 'normal', later: [], status: 'kept' }
const at = (m, d, h = 12) => new Date(2026, m - 1, d, h, 0, 0).toISOString()
const row = (id, when, text, extra = {}) => ({ ...base, id, at: when, day: new Date(when).toLocaleDateString('sv-SE'), then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: { at: when }, ...extra } })

function library(dir) {
  put(dir, 'self-experience.jsonl', [
    row('exp_sep', at(9, 20), '九月底在旧书摊翻到一本灯塔画册'),
    row('exp_first', at(11, 2), '第一天去灯塔书店上班', { feeling: ['紧张'] }),
    row('exp_key', at(11, 10), '店长把钥匙交给我', { feeling: ['被信任'] }),
    row('exp_hurt', at(11, 12), '那天被当众批评')
  ])
  put(dir, 'later-events.jsonl', [{ id: 'exp_first', at: at(11, 14), day: '2026-11-14', thought: '现在已经熟了', reason: '', feeling: ['安心'] }])
  put(dir, 'link-events.jsonl', [
    { from: 'exp_first', to: 'exp_key', at: at(11, 15), day: '2026-11-15', reason: '都是被人接住的感觉' },
    { from: 'exp_key', to: 'exp_hurt', at: at(11, 15, 13), day: '2026-11-15', reason: '同一个店长' }
  ])
  put(dir, 'chapter-events.jsonl', [
    { id: 'ch_shop', at: at(11, 3), day: '2026-11-03', action: 'open', name: '在灯塔书店打工的日子', from: '2026-11-01', to: '', note: '' },
    { id: 'ch_shop', at: at(11, 16), day: '2026-11-16', action: 'rename', name: '灯塔书店的那个秋天' },
    { id: 'ch_week', at: at(11, 11), day: '2026-11-11', action: 'open', name: '拿到钥匙的那周', from: '2026-11-09', to: '2026-11-15', note: '' }
  ])
  put(dir, 'seal-events.jsonl', [{ id: 'exp_hurt', at: at(11, 13), day: '2026-11-13', action: 'seal', note: '' }])
}

test('事后联想：两头都看得见；另一头封存了的，连理由也不给', (t) => {
  const dir = tmp(t); library(dir)
  const first = exp.currentView(dir, 'exp_first')
  assert.deepEqual(first.links.map((l) => [l.id, l.reason]), [['exp_key', '都是被人接住的感觉']])
  const key = exp.currentView(dir, 'exp_key')
  assert.deepEqual(key.links.map((l) => l.id).sort(), ['exp_first', 'exp_hurt'])
  assert.equal(key.links.find((l) => l.id === 'exp_hurt').sealed, true)
  assert.equal(key.links.find((l) => l.id === 'exp_hurt').reason, undefined, '封存的另一头，原始 links 里也不能带理由')
  assert.equal(key.links.find((l) => l.id === 'exp_hurt').text, undefined, '封存的另一头，原始 links 里也不能带正文')
  const text = exp.renderTwoPart(key)
  assert.match(text, /你后来把它和这些事连在一起：.*「第一天去灯塔书店上班」——都是被人接住的感觉/)
  assert.match(text, /（一件你封存了的事）/)
  assert.doesNotMatch(text, /同一个店长|批评/)
  assert.equal(exp.currentView(dir, 'exp_first', { asOf: at(11, 14, 23) }).links, undefined, '那时还没连')
})

test('事后联想：要理由、不能连自己、两条都得在；同一对不分方向只连一次；并发也只记一次', async (t) => {
  const dir = tmp(t)
  const a = exp.addExperience(dir, { text: '一' })
  const b = exp.addExperience(dir, { text: '二' })
  assert.match(exp.linkExperiences(dir, { from: a.id, to: b.id }).error, /为什么/)
  assert.match(exp.linkExperiences(dir, { from: a.id, to: a.id, reason: 'x' }).error, /和它自己/)
  assert.match(exp.linkExperiences(dir, { from: a.id, to: 'exp_nope', reason: 'x' }).error, /找不到这条经历：exp_nope/)
  assert.equal(fs.existsSync(linkEvents.eventsFile(dir)), false)

  const worker = path.join(dir, 'link-worker.mjs')
  fs.writeFileSync(worker, `import * as exp from ${JSON.stringify(new URL('../packages/core/lib/self-experience.js', import.meta.url).href)}\nconst [d, x, y] = process.argv.slice(2)\nprocess.exit(exp.linkExperiences(d, { from: x, to: y, reason: '有关' }).ok ? 0 : 1)\n`)
  await Promise.all([[a.id, b.id], [b.id, a.id], [a.id, b.id]].map(([x, y]) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [worker, dir, x, y], { stdio: 'ignore' })
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker ' + code))))
  })))
  assert.equal(linkEvents.readAll(dir).rows.length, 1)
})

test('人生章节：按日期落进去、可以重叠；改名留着旧名；翻回那天看到的是那时的叫法', (t) => {
  const dir = tmp(t); library(dir)
  const now = chapterEvents.chapters(dir)
  assert.deepEqual(now.map((c) => [c.id, c.name, c.to]), [['ch_shop', '灯塔书店的那个秋天', ''], ['ch_week', '拿到钥匙的那周', '2026-11-15']])
  assert.deepEqual(now[0].names, ['在灯塔书店打工的日子', '灯塔书店的那个秋天'])
  assert.deepEqual(exp.currentView(dir, 'exp_key').chapters.map((c) => c.name), ['灯塔书店的那个秋天', '拿到钥匙的那周'])
  assert.equal(exp.currentView(dir, 'exp_sep').chapters, undefined, '九月不在任何章节里')
  assert.match(exp.renderTwoPart(exp.currentView(dir, 'exp_first')), /你把那段日子叫做「灯塔书店的那个秋天」/)

  const then = exp.currentView(dir, 'exp_first', { asOf: at(11, 12) })
  assert.deepEqual(then.chapters.map((c) => c.name), ['在灯塔书店打工的日子'], '那时还没改名')
  assert.equal(exp.currentView(dir, 'exp_first', { asOf: at(11, 2, 20) }).chapters, undefined, '那时还没起这个名字')
})

test('人生章节：名字、日期都要合法；重复开是空操作；改不存在的章节报错', (t) => {
  const dir = tmp(t)
  assert.throws(() => chapterEvents.open(dir, { name: '', from: '2026-11-01' }), /要有个名字/)
  assert.throws(() => chapterEvents.open(dir, { name: 'x'.repeat(31), from: '2026-11-01' }), /太长/)
  assert.throws(() => chapterEvents.open(dir, { name: '秋天', from: '2026-11-31' }), /日期不存在/)
  assert.throws(() => chapterEvents.open(dir, { name: '秋天', from: '11月1日' }), /2026-11-01 这样/)
  assert.throws(() => chapterEvents.open(dir, { name: '秋天', from: '2026-11-10', to: '2026-11-01' }), /早于/)
  const first = chapterEvents.open(dir, { name: '秋天', from: '2026-11-01' })
  assert.equal(first.noop, false)
  assert.equal(chapterEvents.open(dir, { name: '秋天', from: '2026-11-01' }).noop, true)
  assert.equal(chapterEvents.rename(dir, { id: first.row.id, name: '秋天' }).noop, true, '同名不算改名')
  assert.throws(() => chapterEvents.rename(dir, { id: 'ch_nope', name: '冬天' }), /找不到这个章节/)
  assert.throws(() => chapterEvents.close(dir, { id: first.row.id, to: '2026-10-01' }), /早于开始日期/)
  assert.equal(chapterEvents.close(dir, { id: first.row.id, to: '2026-11-30' }).noop, false)
  assert.equal(chapterEvents.chapters(dir)[0].to, '2026-11-30')
})

test('她的书：按章节分组、章节外按月份、时间顺序；封存的不收只计数；当时原样、后来接在后面', (t) => {
  const dir = tmp(t); library(dir)
  const md = renderBook(dir, { now: new Date(2026, 10, 16, 21) })
  assert.match(md, /^# 她的自传/)
  assert.match(md, /收了 3 件；有 1 件她封存了的事没有收进来/)
  assert.doesNotMatch(md, /被当众批评|同一个店长/)
  const sep = md.indexOf('## 2026-09'), shop = md.indexOf('## 灯塔书店的那个秋天')
  assert.ok(sep > 0 && shop > sep, '九月那节排在十一月的章节前面')
  assert.match(md, /以前叫「在灯塔书店打工的日子」/)
  assert.match(md, /第一天去灯塔书店上班\n\n- 当时的感觉：紧张\n\n\*\*后来\*\*\n\n- 2026-11-14：现在已经熟了（再想起时：安心）/)
  const week = md.indexOf('## 拿到钥匙的那周')
  assert.ok(week > shop, '嵌在"秋天"里的那周有自己的一节，排在后面')
  assert.ok(md.indexOf('### 2026-11-10\n\n店长把钥匙交给我') > week, '钥匙那条的正文放进更具体的"那周"')
  assert.match(md, /也在这段日子里：「灯塔书店的那个秋天」/)
  assert.equal((md.match(/店长把钥匙交给我/g) || []).length, 2, '正文一次 + 被联想提到一次，不因为属于两个章节印两遍')

  const all = renderBook(dir, { includeSealed: true })
  assert.match(all, /那天被当众批评/)
  assert.match(all, /这件事她封存了/)

  const early = renderBook(dir, { asOf: '2026-11-11' })
  assert.match(early, /截至 2026-11-11 的样子/)
  assert.match(early, /## 在灯塔书店打工的日子/, '那时还叫旧名字')
  assert.doesNotMatch(early, /现在已经熟了|被人接住/)
})

for (const script of CLIS) {
  test('CLI：link / chapter / book，导出导入带着联想和章节（' + script + '）', (t) => {
    const data = tmp(t), other = tmp(t), outDir = tmp(t)
    const run = (d, args) => {
      const r = spawnSync(process.execPath, [path.join(root, script), ...args, '--data', d], { encoding: 'utf8' })
      return { code: r.status, json: JSON.parse(r.stdout) }
    }
    library(memOf(data))
    const a = run(data, ['write', '--text', '今天又去了书店']).json.id
    assert.equal(run(data, ['link', '--from', a, '--to', 'exp_first', '--reason', '同一家店']).json.noop, false)
    assert.equal(run(data, ['link', '--from', 'exp_first', '--to', a, '--reason', '再连一次']).json.noop, true)
    assert.equal(run(data, ['link', '--from', a, '--to', 'exp_first']).code, 1)

    const opened = run(data, ['chapter', 'open', '--name', '冬天之前', '--from', '2026-11-16']).json
    assert.equal(opened.ok, true)
    assert.equal(run(data, ['chapter', 'rename', '--id', opened.chapter.id, '--name', '入冬']).json.noop, false)
    const list = run(data, ['chapter', 'list']).json.chapters
    assert.deepEqual(list.map((c) => c.name), ['灯塔书店的那个秋天', '拿到钥匙的那周', '入冬'])
    assert.equal(list.find((c) => c.id === 'ch_shop').experiences, 4, '11-02、11-10、封存的 11-12、今天新写的一条（章节没写结束日期）')
    assert.equal(run(data, ['chapter', 'open', '--name', '', '--from', '2026-11-01']).code, 1)

    const md = run(data, ['book']).json.markdown
    assert.match(md, /## 入冬/)
    const file = path.join(outDir, '她的书.md')
    assert.equal(run(data, ['book', '--out', file]).json.file, file)
    assert.ok(fs.readFileSync(file, 'utf8').startsWith('# 她的自传'))
    assert.equal(run(data, ['book', '--out', path.join(memOf(data), 'book.md')]).code, 1, '不写进记忆目录')

    const exported = run(data, ['export', '--out', outDir]).json
    assert.equal(run(other, ['import', '--from', exported.dir]).json.ok, true)
    const back = run(other, ['read', '--id', a]).json.items[0].view
    assert.match(back, /你后来把它和这些事连在一起：.*同一家店/)
    assert.match(back, /你把那段日子叫做「灯塔书店的那个秋天」、「入冬」/)
    assert.equal(run(other, ['doctor']).json.ok, true)
  })
}
