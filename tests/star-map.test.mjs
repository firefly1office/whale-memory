// 记忆星图（tools/star-map.mjs）：0 / 1 / 200 条都能画；封存与抽屉的正文按字节不在 HTML 里；
// 坏行一律报错；零依赖、不联网；只读。
//
// 封存那条检查是**反证过的**：同一份数据解封之后，被藏起来的正文必须重新出现——
// 否则"搜不到"可能只是因为这条记录根本没被读进来。把 tools/star-map.mjs 里
// `if (row.sealed) { sealedHidden += 1; continue }` 这一行去掉/改成不跳过，本文件会红。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as exp from '../packages/core/lib/self-experience.js'
import { buildGraph, generateStarMap, resolveMemoryDir, writeStarMap } from '../tools/star-map.mjs'
import { buildCorpus } from '../tools/lib/eval-v2-corpus.mjs'
import { safeRemove, tmpDir } from './_safety.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const NOW = new Date('2026-11-27T00:30:00+08:00')
const deep = (dir) => path.join(dir, 'plugin-data', 'biomimetic-memory')
const ok = (dir, opts = {}) => generateStarMap(dir, { now: NOW, ...opts })
const bytesOf = (html) => Buffer.from(html, 'utf8')
const has = (bytes, text) => bytes.includes(Buffer.from(String(text), 'utf8'))

function fixture(corpusName) {
  const dir = tmpDir('whale-starmap-')
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'eval', corpusName), 'utf8'))
  const { memoryDir } = buildCorpus(dir, corpus)
  return { dir, corpus, memoryDir }
}

// 目录里每个文件的「名字 + 大小 + 哈希」：用来证明出图没有动过记忆目录
function snapshot(dir) {
  const out = []
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name)
      const rel = prefix ? prefix + '/' + e.name : e.name
      if (e.isDirectory()) { walk(full, rel); continue }
      out.push(rel + ':' + fs.statSync(full).size + ':' + crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'))
    }
  }
  walk(dir, '')
  return out
}

// ---------------------------------------------------------------- 1) 0 / 1 / 200 条都能出图

test('0 条：空目录也出一张完整的图，不把「还没有」当失败', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const { html, stats } = ok(dir)
  assert.equal(stats.experiences, 0)
  assert.equal(stats.visible, 0)
  assert.equal(stats.clusterCount, 0)
  assert.equal(stats.edges.total, 0)
  assert.match(html, /^<!doctype html>/)
  assert.ok(html.includes('<svg'), '空图也要有 SVG 画布')
  assert.ok(html.includes('还没有可以画进星图的经历'), '空的时候要说清楚为什么是空的')
  assert.ok(!html.includes('<script'), '不带脚本：自包含、也不需要交互')
})

test('1 条：一颗星也能出图，有正文、没有连线', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const row = exp.addExperience(dir, { text: '一个人把窗台擦干净，坐下看了会儿云' })
  const { html, stats } = ok(dir)
  assert.equal(stats.experiences, 1)
  assert.equal(stats.visible, 1)
  assert.equal(stats.clusterCount, 1)
  assert.equal(stats.edges.total, 0)
  assert.equal(stats.nodes[0].id, row.id)
  assert.ok(html.includes('一个人把窗台擦干净'), '这颗星的正文要在图里（悬停提示/列表）')
  assert.ok(html.includes('画进来 1 颗星'), '页眉要报数')
  // 一颗星：一个 <title> 提示（head 里那个是页面标题，不算）
  assert.equal((html.match(/<title>/g) || []).length, 2)
})

test('200 条：评测语料铺出来的星图（194 颗星 + 6 件封存的不进图）', (t) => {
  const { dir, memoryDir } = fixture('corpus-v2.json')
  t.after(() => safeRemove(dir))
  const { html, stats } = ok(memoryDir, { title: '记忆星图 · 评测语料（200 条）' })
  assert.equal(stats.experiences, 200, '语料就是 200 条')
  assert.equal(stats.sealedHidden, 6, 'corpus-v2 封存了 6 条')
  assert.equal(stats.visible, 194, '看得见的 194 条')
  assert.equal(stats.visible + stats.sealedHidden, stats.experiences)
  assert.ok(stats.clusterCount >= 5, '按章节/月份分成几段日子，实际 ' + stats.clusterCount)
  assert.ok(stats.edges.total > 0, '语料里有 refs 与 link，图上也该有连线')
  assert.equal(stats.nodes.length, stats.visible)
  assert.ok(bytesOf(html).length > 40000, '200 条的图不该是一张空壳')
  assert.ok(html.includes('aria-label="记忆星图：194 颗星'), 'SVG 的无障碍说明要跟着数据走')
  assert.ok(html.includes('另外 6 件她封存了的事没有画进来'))
  // 同一份数据再出一次：逐字节相同（不是随机撒点）
  assert.equal(ok(memoryDir, { title: '记忆星图 · 评测语料（200 条）' }).html, html)
})

// ---------------------------------------------------------------- 2) 封存与抽屉：按字节搜不到

test('封存正文按字节搜不到；抽屉正文也搜不到；可见正文必须在（证否反向检查）', (t) => {
  const { dir, corpus, memoryDir } = fixture('corpus.json')
  t.after(() => safeRemove(dir))
  const { html, stats } = ok(memoryDir)
  const bytes = bytesOf(html)

  assert.equal(stats.sealedHidden, Object.keys(corpus.sealedMarkers).length)

  // 1) 封存记录的整段正文、想法、没弄完的事：一个字节都不许出现
  let checked = 0
  for (const id of Object.keys(corpus.sealedMarkers)) {
    const row = corpus.experiences.find((e) => e.id === id)
    const bodies = [row.text, row.thought, row.unfinished, row.scene].filter(Boolean)
    for (const body of bodies) {
      checked += 1
      assert.ok(!has(bytes, body), '封存的正文漏进了 HTML（' + id + '）：' + body.slice(0, 20))
    }
    // 封存记录的 id 也不该留下线索
    assert.ok(!has(bytes, id), '封存的 id 不该出现：' + id)
  }
  assert.ok(checked >= 6, '封存正文的检查不能是空跑')

  // 2) 抽屉（unsaid-events.jsonl / 契约旧名 unsaid.jsonl）里的话，一个字节也不许出现
  for (const marker of corpus.unsaidMarkers) assert.ok(!has(bytes, marker), '抽屉里的话漏进了 HTML：' + marker)

  // 3) 反证：可见正文必须在，否则上面两条可能只是"整份都没读进来"
  const visible = corpus.experiences.find((e) => !Object.keys(corpus.sealedMarkers).includes(e.id))
  assert.ok(has(bytes, visible.text), '可见的正文必须出现在图里：' + visible.id)

  // 4) 指纹：封存过的 marker 一条都不许留
  for (const list of Object.values(corpus.sealedMarkers)) for (const marker of list) assert.ok(!has(bytes, marker), '封存标记漏了：' + marker)
})

test('封存过滤是活的：解封之后同一份数据里那颗星和连到它的线都回来', (t) => {
  const { dir, corpus, memoryDir } = fixture('corpus.json')
  t.after(() => safeRemove(dir))
  const sealedRow = corpus.experiences.find((e) => e.id === 'e07')
  const before = ok(memoryDir)
  assert.ok(!has(bytesOf(before.html), sealedRow.text))

  const res = exp.setSealed(memoryDir, { id: 'e07', sealed: false })
  assert.equal(res.ok, true)
  const after = ok(memoryDir)
  assert.equal(after.stats.sealedHidden, before.stats.sealedHidden - 1)
  assert.equal(after.stats.visible, before.stats.visible + 1)
  assert.ok(has(bytesOf(after.html), sealedRow.text), '解封之后正文必须回来——否则"搜不到"证明不了过滤在起作用')
  // e27 的 refs 指向 e07：封着的时候这条线不画，解封后补回来
  assert.equal(after.stats.edges.total, before.stats.edges.total + 1)
  assert.equal(after.stats.edges.refs, before.stats.edges.refs + 1)
})

test('抽屉根本不在读路径上：把 unsaid 文件换成目录，出图照旧（没读过它）', (t) => {
  const { dir, memoryDir } = fixture('corpus-v2.json')
  t.after(() => safeRemove(dir))
  for (const name of ['unsaid-events.jsonl', 'unsaid.jsonl']) {
    const file = path.join(memoryDir, name)
    fs.rmSync(file, { force: true, recursive: true })
    fs.mkdirSync(file) // 是目录：谁去 readFileSync 都会抛 EISDIR
  }
  const { html, stats } = ok(memoryDir)
  assert.equal(stats.experiences, 200)
  assert.ok(html.includes('<svg'))
})

// ---------------------------------------------------------------- 3) 坏行报错，不当成空

test('经历文件坏一行就报错，不画一张「看起来完整」的图，也不留下半张图', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const mem = deep(dir)
  exp.addExperience(mem, { text: '第一条' })
  fs.appendFileSync(path.join(mem, 'self-experience.jsonl'), '{"id":"exp_broken", "then":{"text":"截断\n', 'utf8')
  assert.throws(() => ok(mem), (error) => {
    assert.equal(error.code, 'EXPERIENCE_CORRUPT')
    assert.match(error.message, /无法解析/)
    return true
  })
  const out = path.join(dir, 'map.html')
  assert.throws(() => writeStarMap(mem, out, { now: NOW }), /无法解析/)
  assert.equal(fs.existsSync(out), false, '数据坏了不该落下一张残图')
})

test('事件日志坏一行也报错（连线与星星大小都靠它）', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const mem = deep(dir)
  const a = exp.addExperience(mem, { text: 'A' })
  const b = exp.addExperience(mem, { text: 'B' })
  exp.linkExperiences(mem, { from: a.id, to: b.id, reason: '两件事有关' })
  exp.markRecalled(mem, a.id)
  // 三本事件账都要先存在：封了再解，两行都是有效的，B 仍然是看得见的
  assert.equal(exp.setSealed(mem, { id: b.id, sealed: true }).ok, true)
  assert.equal(exp.setSealed(mem, { id: b.id, sealed: false }).ok, true)
  const cases = [
    ['link-events.jsonl', '{"from":"x","to":"y"'],
    ['recall-events.jsonl', 'not json at all'],
    ['seal-events.jsonl', '{"id":"x",']
  ]
  for (const [name, broken] of cases) {
    const file = path.join(mem, name)
    const backup = fs.readFileSync(file, 'utf8')
    try {
      fs.appendFileSync(file, broken + '\n', 'utf8')
      assert.throws(() => ok(mem), (error) => {
        assert.equal(error.code, 'STARMAP_EVENT_CORRUPT', name + ' 的坏行没有报错')
        assert.match(error.message, /坏行/)
        return true
      }, name + ' 的坏行应当让出图失败')
    } finally {
      fs.writeFileSync(file, backup, 'utf8')
    }
  }
})

test('目录打错就报错：不存在不等于「一条都没有」', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const missing = path.join(dir, 'not-here')
  assert.throws(() => resolveMemoryDir(missing), (error) => {
    assert.equal(error.code, 'STARMAP_DIR_UNREADABLE')
    return true
  })
  assert.throws(() => generateStarMap(missing, { now: NOW }), /记忆目录读不出来/)
})

// ---------------------------------------------------------------- 4) 数据怎么来：口径与摆位

test('节点大小跟着想起次数走；refs 与 link 都画成连线', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const mem = deep(dir)
  const a = exp.addExperience(mem, { text: '被反复想起的那件小事' })
  const b = exp.addExperience(mem, { text: '另一件事' })
  exp.addExperience(mem, { text: '从上面那件事想到的', refs: [a.id] })
  assert.equal(exp.linkExperiences(mem, { from: a.id, to: b.id, reason: '后来才发现有关' }).ok, true)
  for (let i = 0; i < 6; i++) exp.markRecalled(mem, a.id)

  const { html, stats } = ok(mem)
  const sizeOf = (id) => stats.nodes.find((n) => n.id === id).size
  assert.equal(stats.recallsTotal, 6)
  assert.equal(stats.maxRecalls, 6)
  assert.ok(sizeOf(a.id) > sizeOf(b.id), '被想起 6 次的那颗星要比 0 次的大')
  assert.equal(stats.edges.total, 2)
  assert.equal(stats.edges.refs, 1)
  assert.equal(stats.edges.link, 1)
  assert.ok(html.includes('被想起 6 次'), '悬停提示里要写清想起过几次')
})

test('聚类按章节走：语料里起过名字的那两段会各成一组', (t) => {
  const { dir, memoryDir } = fixture('corpus.json')
  t.after(() => safeRemove(dir))
  const { stats } = ok(memoryDir)
  const labels = stats.clusters.map((c) => c.label)
  assert.ok(labels.includes('读灯塔的那些天'), '章节应当成为一组：' + labels.join(' / '))
  assert.ok(labels.includes('学着修东西的秋天'), '章节应当成为一组：' + labels.join(' / '))
  const total = stats.clusters.reduce((s, c) => s + c.count, 0)
  assert.equal(total, stats.visible, '每颗星只属于一组')
})

test('正文里的尖括号与引号会被转义，不会变成标签', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  exp.addExperience(dir, { text: '她在纸上写 <script>alert("x")</script> & 一句话' })
  const { html } = ok(dir)
  assert.ok(!html.includes('<script'), '正文里的 <script> 不能原样落进 HTML')
  assert.ok(html.includes('&lt;script&gt;'), '应当转义后显示')
  assert.ok(html.includes('&amp; 一句话'))
})

test('全部封存时：一颗星都不画，只说有几件她封存了的事，正文一个字节也不出现', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const a = exp.addExperience(dir, { text: '全部封存-甲-ONLY-SEALED-1' })
  const b = exp.addExperience(dir, { text: '全部封存-乙-ONLY-SEALED-2' })
  for (const row of [a, b]) assert.equal(exp.setSealed(dir, { id: row.id, sealed: true }).ok, true)
  const { html, stats } = ok(dir)
  assert.equal(stats.experiences, 2)
  assert.equal(stats.visible, 0)
  assert.equal(stats.sealedHidden, 2)
  const bytes = bytesOf(html)
  assert.ok(!has(bytes, 'ONLY-SEALED-1') && !has(bytes, 'ONLY-SEALED-2'))
  assert.ok(html.includes('她封存了的事不画在图上'), '要说明为什么图上是空的')
})

test('重复 id 只画一颗星（事件不会挂到两条上）', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const mem = deep(dir)
  const row = exp.addExperience(mem, { text: '原件' })
  fs.appendFileSync(path.join(mem, 'self-experience.jsonl'), JSON.stringify({ ...row, then: { ...row.then, text: '同 id 的第二次导入' } }) + '\n', 'utf8')
  const { stats } = ok(mem)
  assert.equal(stats.experiences, 2)
  assert.equal(stats.duplicates, 1)
  assert.equal(stats.visible, 1)
})

// ---------------------------------------------------------------- 5) 零依赖、不联网、只读

test('零第三方依赖、不联网：源码只用 node: 内置与相对模块，HTML 里没有任何 http 地址', (t) => {
  const source = fs.readFileSync(path.join(root, 'tools/star-map.mjs'), 'utf8')
  const imports = [...source.matchAll(/^import\s.+?from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.ok(imports.length >= 3, '应当能读出 import 语句')
  for (const spec of imports) {
    assert.ok(spec.startsWith('node:') || spec.startsWith('.'), '不许引第三方包：' + spec)
  }
  for (const banned of ['fetch(', 'XMLHttpRequest', "from 'http'", "from 'node:http'", "from 'https'", "from 'node:https'", "require("]) {
    assert.ok(!source.includes(banned), '不该出现：' + banned)
  }

  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  exp.addExperience(dir, { text: '联网检查' })
  const { html } = ok(dir)
  assert.ok(!/https?:\/\//i.test(html), '生成物里不许有任何 http/https 地址（含 xmlns 与外链字体）')
  assert.ok(!html.includes('<script'), '不带脚本')
  assert.ok(!html.includes('<link'), '不引外部样式')
  assert.ok(!html.includes('src='), '不引外部图片/脚本')
  assert.ok(!html.includes('@import'), 'CSS 不引外部资源')
  assert.ok(html.includes('<style>'), '样式内联')
  // 导出物里不许出现本机路径（机器名、用户名、目录结构都算泄漏）
  assert.ok(!html.includes(dir), '导出物里不该出现记忆目录的绝对路径')
})

test('只读：出图前后记忆目录逐文件字节不变，输出只写到 --out 那个文件', (t) => {
  const { dir, memoryDir } = fixture('corpus-v2.json')
  t.after(() => safeRemove(dir))
  const before = snapshot(memoryDir)
  const out = path.join(dir, 'star-map.html')
  const res = writeStarMap(memoryDir, out, { now: NOW })
  assert.equal(res.path, out)
  assert.equal(fs.existsSync(out), true)
  assert.deepEqual(snapshot(memoryDir), before, '星图不该改记忆目录里的任何字节')
  // 也不该在记忆目录里留下任何东西
  assert.equal(fs.existsSync(path.join(memoryDir, 'star-map.html')), false)
})

test('确定性：同一份数据 + 同一个导出时间，两次生成逐字节相同', (t) => {
  const dir = tmpDir('whale-starmap-')
  t.after(() => safeRemove(dir))
  const mem = deep(dir)
  for (let i = 0; i < 8; i++) exp.addExperience(mem, { text: '第 ' + i + ' 件事，凑够几颗星' })
  const a = ok(mem)
  const b = ok(mem)
  assert.equal(a.html, b.html)
  assert.notEqual(a.html, ok(mem, { now: new Date('2026-12-01T00:00:00+08:00') }).html, '导出时间变了，图上那句话也要变')
})

// ---------------------------------------------------------------- 6) 命令行与路径

test('命令行：--data/--out/--now 写出和 API 一样的文件，坏数据退出码 1', (t) => {
  const { dir, memoryDir } = fixture('corpus.json')
  t.after(() => safeRemove(dir))
  const out = path.join(dir, 'cli.html')
  const res = spawnSync(process.execPath, [
    path.join(root, 'tools/star-map.mjs'),
    '--data=' + memoryDir,
    '--out=' + out,
    '--now=2026-11-27T00:30:00+08:00',
    '--title=记忆星图'
  ], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stdout + res.stderr)
  assert.match(res.stdout, /写好了/)
  const fromCli = fs.readFileSync(out, 'utf8')
  assert.equal(fromCli, ok(memoryDir).html, '命令行与 API 必须是同一张图')

  const bad = path.join(dir, 'no-such-dir')
  const failed = spawnSync(process.execPath, [path.join(root, 'tools/star-map.mjs'), '--data=' + bad, '--out=' + path.join(dir, 'x.html')], { encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /记忆目录读不出来/)
  assert.equal(fs.existsSync(path.join(dir, 'x.html')), false)
})

test('路径：给数据根目录也能找到库；--help 不读盘', (t) => {
  const { dir, memoryDir } = fixture('corpus.json')
  t.after(() => safeRemove(dir))
  assert.equal(resolveMemoryDir(dir), memoryDir, '数据根目录要落到 plugin-data/biomimetic-memory')
  assert.equal(resolveMemoryDir(memoryDir), memoryDir)
  const help = spawnSync(process.execPath, [path.join(root, 'tools/star-map.mjs'), '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--data=/)
  assert.match(help.stdout, /只读/)
})

test('buildGraph 是纯函数：封存与抽屉都在它之前就分开了', () => {
  const rows = [
    { id: 'a', day: '2026-11-01', then: { text: 'A' }, refsInfo: [{ id: 'b', day: '2026-11-02' }], links: [] },
    { id: 'b', day: '2026-11-02', then: { text: 'B' }, refsInfo: [], links: [] },
    { id: 'c', day: '2026-11-03', then: { text: '封着的' }, sealed: { day: '2026-11-04' }, refsInfo: [], links: [] }
  ]
  const graph = buildGraph(rows)
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.sealedHidden, 1)
  assert.equal(graph.edges.length, 1)
  assert.deepEqual([graph.edges[0].a, graph.edges[0].b].sort(), ['a', 'b'])
})