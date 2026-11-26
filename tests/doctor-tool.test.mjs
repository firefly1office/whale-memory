// 体检工具：正常目录退出 0；故意弄坏的目录退出 1，并且 --json 里能指出是哪项坏了。
// 一切数据目录都用 fs.mkdtempSync 现造现删，不碰任何真实数据。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const RECORDS = 'self-experience.jsonl'
const EVENT_FILES = ['later-events.jsonl', 'seal-events.jsonl', 'recall-events.jsonl', 'unfinished-events.jsonl', 'link-events.jsonl', 'chapter-events.jsonl']

// node:sqlite 要 Node >= 22.5；没有它时"迁移后又写过"那条用例跳过（其它照跑）
const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-doctor-tool-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const writeJsonl = (dir, name, rows) => fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

// 线上格式的经历行：id / at / day / then.text 都齐（doctor 只数行和 id，这里照着真格式造）
const record = (id, text) => ({
  id,
  at: '2026-11-20T10:00:00.000Z',
  day: '2026-11-20',
  author: 'self',
  source: 'own-time',
  kind: '其它',
  weight: 'normal',
  then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: { at: '2026-11-20T10:00:00.000Z' } },
  later: [],
  status: 'kept'
})

const AT = '2026-11-20T10:00:00.000Z'
const DAY = '2026-11-20'

// 一个"健康"的目录：主文件 + 六类事件都在，封存指向真存在的经历，没有坏行，没迁移
function makeHealthy(t) {
  const dir = tmp(t)
  writeJsonl(dir, RECORDS, [record('exp_a', '灯塔还亮着'), record('exp_b', '今天折了纸船')])
  writeJsonl(dir, 'later-events.jsonl', [{ id: 'exp_a', at: AT, day: DAY, thought: '后来还是没去问' }])
  writeJsonl(dir, 'seal-events.jsonl', [{ id: 'exp_a', at: AT, day: DAY, action: 'seal', note: '先不想被提起' }])
  writeJsonl(dir, 'recall-events.jsonl', [{ id: 'exp_b', at: AT, day: DAY }])
  writeJsonl(dir, 'unfinished-events.jsonl', [{ id: 'exp_b', at: AT, day: DAY, choice: 'shelved', note: '' }])
  writeJsonl(dir, 'link-events.jsonl', [{ from: 'exp_a', to: 'exp_b', at: AT, day: DAY, reason: '都在等' }])
  writeJsonl(dir, 'chapter-events.jsonl', [{ id: 'ch_1', at: AT, day: DAY, action: 'open', name: '灯塔的秋天', from: '2026-11-01', to: '', note: '' }])
  return dir
}

// 一律按"仓库根 + 相对脚本路径"跑，参数风格和人在命令行里敲的一致
function run(dir, ...flags) {
  return spawnSync(process.execPath, ['tools/doctor.mjs', dir, ...flags], { cwd: root, encoding: 'utf8' })
}

const named = (json, name) => {
  const hit = json.checks.find((c) => c.name === name)
  assert.ok(hit, '体检结果里应该有「' + name + '」这一项')
  return hit
}

test('体检：正常目录退出 0，每项都通过', (t) => {
  const dir = makeHealthy(t)
  const r = run(dir, '--json')
  assert.equal(r.status, 0, r.stderr)
  const json = JSON.parse(r.stdout)

  assert.equal(json.ok, true)
  assert.equal(json.checks.length, 6, '六项检查')
  for (const c of json.checks) {
    assert.equal(typeof c.name, 'string')
    assert.equal(typeof c.detail, 'string')
    assert.equal(c.ok, true, c.name + '：' + c.detail)
  }
  for (const name of ['数据目录', '文件存在', '行数', '坏行', '封存一致性', '迁移状态']) {
    named(json, name)
  }
  assert.match(named(json, '行数').detail, /经历 2 行/, '经历条数要报出来')
  assert.match(named(json, '坏行').detail, /没有坏行/)
  assert.match(named(json, '封存一致性').detail, /封存 1 条/, '封存事件也报出来')
  assert.match(named(json, '迁移状态').detail, /还没迁移/, '没迁移是正常状态，不是错')
})

test('体检：追加一行坏 JSON，退出 1，--json 指出「坏行」', (t) => {
  const dir = makeHealthy(t)
  fs.appendFileSync(path.join(dir, RECORDS), '{"broken":\n', 'utf8')

  const r = run(dir, '--json')
  assert.equal(r.status, 1, '有坏行必须退出 1')
  const json = JSON.parse(r.stdout)
  assert.equal(json.ok, false)

  const bad = named(json, '坏行')
  assert.equal(bad.ok, false)
  assert.match(bad.detail, /self-experience\.jsonl 1 行无法解析/, '要说清是哪个文件、几行')
  // 其它项不该被连坐：文件都在、封存也还指向存在的经历
  assert.equal(named(json, '文件存在').ok, true)
  assert.equal(named(json, '封存一致性').ok, true)
  assert.equal(named(json, '迁移状态').ok, true)
})

test('体检：事件文件还没出现是正常状态（按需创建），不算失败', (t) => {
  const dir = makeHealthy(t)
  fs.rmSync(path.join(dir, 'link-events.jsonl'))

  const r = run(dir, '--json')
  assert.equal(r.status, 0, '事件文件按需创建：还没出现过不是故障')
  const json = JSON.parse(r.stdout)
  assert.equal(json.ok, true, JSON.stringify(json.checks.filter((c) => !c.ok)))
  const exists = named(json, '文件存在')
  assert.equal(exists.ok, true)
  assert.match(exists.detail, /link/, '要在 detail 里说清哪个还没出现')
  assert.equal(named(json, '行数').ok, true, '缺一个还没出现的事件文件，行数照样算得出来')
  assert.match(named(json, '行数').detail, /link —/, '还没出现的文件用「—」标出来，不冒充 0 行')
})

test('体检：只有主文件、一个事件文件都没有，同样健康（真实的数据目录就是这样）', (t) => {
  const dir = tmp(t)
  writeJsonl(dir, RECORDS, [record('exp_a', '灯塔还亮着')])
  const r = run(dir, '--json')
  assert.equal(r.status, 0, JSON.stringify(JSON.parse(r.stdout).checks.filter((c) => !c.ok)))
  const json = JSON.parse(r.stdout)
  assert.match(named(json, '文件存在').detail, /还没出现/)
  assert.match(named(json, '行数').detail, /经历 1 行/)
})

test('体检：经历主文件不见了、事件文件还在 → 退出 1（这才是真丢了）', (t) => {
  const dir = makeHealthy(t)
  fs.rmSync(path.join(dir, RECORDS))
  const r = run(dir, '--json')
  assert.equal(r.status, 1, '有事件没正文，不能报通过')
  const json = JSON.parse(r.stdout)
  const exists = named(json, '文件存在')
  assert.equal(exists.ok, false)
  assert.match(exists.detail, /不见了/, '要说清是主文件不见了')
  assert.equal(named(json, '行数').ok, false, '主文件不在时行数没法算')
})

test('体检：全新空目录退出 0（还没开始记，不是坏了）', (t) => {
  const dir = tmp(t)
  const r = run(dir, '--json')
  assert.equal(r.status, 0)
  const json = JSON.parse(r.stdout)
  assert.match(named(json, '文件存在').detail, /全新目录/)
})

test('体检：封存事件指向不存在的经历，退出 1', (t) => {
  const dir = makeHealthy(t)
  // 往封存日志里追加一条指向已不存在的 id：手改日志或写路径出错时就是这种局面
  fs.appendFileSync(path.join(dir, 'seal-events.jsonl'), JSON.stringify({ id: 'exp_ghost', at: AT, day: DAY, action: 'seal' }) + '\n', 'utf8')

  const r = run(dir, '--json')
  assert.equal(r.status, 1)
  const seal = named(JSON.parse(r.stdout), '封存一致性')
  assert.equal(seal.ok, false)
  assert.match(seal.detail, /exp_ghost/, '要点名是哪条封存对不上')
})

sq('体检：迁移后又往 JSONL 追加，退出 1，--json 报「迁移状态」过期', (t) => {
  const dir = makeHealthy(t)
  const migrated = spawnSync(process.execPath, ['tools/migrate-storage.mjs', dir, '--write'], { cwd: root, encoding: 'utf8' })
  assert.equal(migrated.status, 0, migrated.stderr)
  assert.ok(fs.existsSync(path.join(dir, 'memory.sqlite')), '迁移应该生成 memory.sqlite')

  // 库已经是迁移时的样子，之后再写一行：sqlite 读出来会少一条，体检必须报出来
  fs.appendFileSync(path.join(dir, RECORDS), JSON.stringify(record('exp_c', '迁移之后才写的')) + '\n', 'utf8')

  const r = run(dir, '--json')
  assert.equal(r.status, 1, '库过期必须退出 1')
  const json = JSON.parse(r.stdout)
  assert.equal(json.ok, false)
  const storage = named(json, '迁移状态')
  assert.equal(storage.ok, false)
  assert.match(storage.detail, /STORAGE_STALE/, '错误码要写进 detail，机器能认')
  assert.equal(named(json, '坏行').ok, true, '库过期不是坏行，别混在一起')
})

test('体检：主文件读不出来（被换成目录）退出 1，不当成空库', (t) => {
  const dir = makeHealthy(t)
  fs.rmSync(path.join(dir, RECORDS))
  fs.mkdirSync(path.join(dir, RECORDS))

  const r = run(dir, '--json')
  assert.equal(r.status, 1, '读不出来必须走失败')
  const json = JSON.parse(r.stdout)
  assert.equal(json.ok, false)
  const exists = named(json, '文件存在')
  assert.equal(exists.ok, false)
  assert.match(exists.detail, /读不出来.*self-experience\.jsonl（EISDIR）/, '要说清是哪个文件、什么错')
  assert.match(named(json, '行数').detail, /EISDIR/)
  assert.equal(named(json, '坏行').ok, false, '读不出来不能报成「没有坏行」')
})

test('体检：目录根本不存在时退出 1，不静默当通过', () => {
  const ghost = path.join(tmp(test), 'not-here')
  const r = run(ghost, '--json')
  assert.equal(r.status, 1, '读不出来必须走失败')
  const json = JSON.parse(r.stdout)
  assert.equal(json.ok, false)
  assert.equal(named(json, '数据目录').ok, false)
  assert.equal(named(json, '文件存在').ok, false)
})

test('体检：不带 --json 时打中文人读版本', (t) => {
  const dir = makeHealthy(t)
  const r = run(dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /体检：/, '要有中文标题')
  assert.match(r.stdout, /✓ 文件存在：/, '每项一行，带对勾')
  assert.match(r.stdout, /全部通过/, '最后给一句结论')

  // 坏目录的人读版本也要能一眼看出哪项没通过
  fs.appendFileSync(path.join(dir, RECORDS), '{oops\n', 'utf8')
  const bad = run(dir)
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /✗ 坏行：/)
  assert.match(bad.stdout, /1 项没通过/)
})