// 0.10.1 回归：旧 id 升级、重复回滚、后记渲染、--data、防编造口径、隐私默认、设置不被冲掉
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove, tmpDir } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as mem from '../packages/core/lib/self-memory.js'
import * as waking from '../packages/core/lib/waking.js'
import * as settings from '../packages/core/lib/self-settings.js'
import * as laterMigration from '../tools/migrate-later-events.mjs'
import * as recallMigration from '../tools/migrate-recall-events.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]

function tmp(t) {
  const dir = tmpDir('whale-upgrade-test-')
  t.after(() => safeRemove(dir))
  return dir
}

const memDir = (dataDir) => path.join(dataDir, 'plugin-data', 'biomimetic-memory')
const putRows = (dir, name, rows) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8')

test('改主意：id 不存在就明说，不留孤儿事件', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '灯塔' })
  const res = exp.reviseExperience(dir, { id: 'exp_typo', thought: '这条不该被记下' })
  assert.equal(res.ok, false)
  assert.match(res.error, /找不到这条经历/)
  assert.equal(fs.existsSync(path.join(dir, 'later-events.jsonl')), false)
})

test('旧格式没有 at：id 每次读都一样，后记不丢', async (t) => {
  const dir = tmp(t)
  putRows(dir, 'self-experience.jsonl', [{ text: '旧记录', thought: '旧想法' }])
  const id = exp.loadAll(dir)[0].id
  assert.equal(exp.reviseExperience(dir, { id, thought: '后来的想法' }).ok, true)
  await new Promise((r) => setTimeout(r, 20))
  const again = exp.loadAll(dir)[0]
  assert.equal(again.id, id)
  assert.deepEqual(again.later.map((l) => l.thought), ['后来的想法'])
})

test('升级：0.10.0 之前旧 id 上的后记和想起，唯一对应时照常读回，多次一致', (t) => {
  const dir = tmp(t)
  const formerId = 'exp_legacy_202605101000'
  putRows(dir, 'self-experience.jsonl', [{ at: '2026-05-10T10:00:05Z', text: '升级前的旧经历' }])
  putRows(dir, 'later-events.jsonl', [{ id: formerId, at: '2026-05-10T10:00:05Z', day: '2026-05-10', thought: '升级前写的后记', reason: '' }])
  putRows(dir, 'recall-events.jsonl', [{ id: formerId, at: '2026-05-10T10:00:05Z', query: '旧' }])
  for (let i = 0; i < 3; i++) {
    const [row] = exp.loadAll(dir)
    assert.deepEqual(row.later.map((l) => l.thought), ['升级前写的后记'])
    assert.equal(row.recalls, 1)
  }
  // 旧 id 也能继续用来改主意，记到当前 id 上
  const res = exp.reviseExperience(dir, { id: formerId, thought: '升级后又想了想' })
  assert.equal(res.ok, true)
  assert.equal(res.id, exp.loadAll(dir)[0].id)
  assert.equal(exp.currentView(dir, formerId).later.length, 2)
  assert.deepEqual(exp.pendingLegacyEvents(dir), [])
})

test('升级：旧 id 被两条旧经历共用时，事件原样保留、报告待核对，不挂给任何一条', (t) => {
  const dir = tmp(t)
  const formerId = 'exp_legacy_202605101000'
  putRows(dir, 'self-experience.jsonl', [
    { at: '2026-05-10T10:00:05Z', text: '同一分钟的第一条' },
    { at: '2026-05-10T10:00:40Z', text: '同一分钟的第二条' }
  ])
  putRows(dir, 'later-events.jsonl', [{ id: formerId, at: '2026-05-10T10:01:00Z', day: '2026-05-10', thought: '说不清是哪条的后记', reason: '' }])
  putRows(dir, 'recall-events.jsonl', [{ id: formerId, at: '2026-05-10T10:01:00Z', query: '' }])
  const laterBefore = read(dir, 'later-events.jsonl')
  const recallBefore = read(dir, 'recall-events.jsonl')

  for (let i = 0; i < 2; i++) {
    const rows = exp.loadAll(dir)
    assert.equal(rows.length, 2)
    for (const r of rows) {
      assert.equal(r.later.length, 0, '不能挂给其中一条')
      assert.equal(r.recalls || 0, 0, '也不能给两条各算一次')
    }
    const pending = exp.pendingLegacyEvents(dir)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].id, formerId)
    assert.deepEqual(pending[0].candidates.slice().sort(), rows.map((r) => r.id).sort())
    assert.equal(pending[0].later, 1)
    assert.equal(pending[0].recalls, 1)
  }
  const res = exp.reviseExperience(dir, { id: formerId, thought: '不知道该记给谁' })
  assert.equal(res.ok, false)
  assert.match(res.error, /好几条旧经历共用/)
  assert.equal(read(dir, 'later-events.jsonl'), laterBefore, '事件文件一个字节都不动')
  assert.equal(read(dir, 'recall-events.jsonl'), recallBefore)
})

for (const [kind, migration] of [['later', laterMigration], ['recall', recallMigration]]) {
  test('回滚：同一份备份回滚两次，原有事件都在（' + kind + '）', (t) => {
    const data = tmp(t)
    const dir = memDir(data)
    const old = exp.addExperience(dir, { text: '迁移前的旧行' })
    const modern = exp.addExperience(dir, { text: '迁移前就有事件' })
    if (kind === 'later') {
      old.later = [{ at: old.at, thought: '行内后记' }]
      assert.equal(exp.reviseExperience(dir, { id: modern.id, thought: '独立事件' }).ok, true)
    } else {
      old.recalls = 1
      assert.equal(exp.markRecalled(dir, modern.id), true)
    }
    putRows(dir, 'self-experience.jsonl', [old, modern])
    const inspect = () => {
      const row = exp.currentView(dir, modern.id)
      return kind === 'later' ? row.later.map((l) => l.thought) : row.recalls || 0
    }
    const before = inspect()
    const result = migration.migrate({ dataDir: data, apply: true })
    assert.equal(result.ok, true)
    for (let i = 0; i < 2; i++) {
      assert.equal(migration.rollback({ dataDir: data, backup: result.backup }).ok, true)
      assert.deepEqual(inspect(), before, '第 ' + (i + 1) + ' 次回滚后')
    }
    assert.ok(fs.existsSync(result.backup + '.events'), '事件备份不能被回滚删掉')
  })
}

test('回滚：迁移前没有事件文件时，回滚只把新文件挪开，不删除', (t) => {
  const data = tmp(t)
  const dir = memDir(data)
  const row = exp.addExperience(dir, { text: '只有行内后记' })
  row.later = [{ at: row.at, thought: '行内后记' }]
  putRows(dir, 'self-experience.jsonl', [row])
  const result = laterMigration.migrate({ dataDir: data, apply: true })
  assert.equal(result.ok, true)
  const res = laterMigration.rollback({ dataDir: data, backup: result.backup })
  assert.equal(res.restoredEvents, false)
  assert.ok(res.movedTo && fs.existsSync(res.movedTo))
  assert.equal(fs.existsSync(path.join(dir, 'later-events.jsonl')), false)
  assert.deepEqual(exp.currentView(dir, row.id).later.map((l) => l.thought), ['行内后记'])
})

test('渲染：这次命中的后记和最近一条都给出来，各带日子，不截断', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '那一夜' })
  const long = '现在我想到一座山，' + '山'.repeat(150)
  for (const thought of ['她看见了邮船', '中间想过一次别的', long]) {
    assert.equal(exp.reviseExperience(dir, { id: row.id, thought }).ok, true)
  }
  const [hit] = exp.recall(dir, '邮船')
  assert.deepEqual(hit.matchedIn, ['later'])
  const text = exp.renderTwoPart(hit)
  const today = new Date().toLocaleDateString('sv-SE')
  assert.ok(text.includes('这次想起它，是因为后来写过：她看见了邮船（' + today + '）'))
  assert.ok(text.includes('最近一次回头想：' + long + '（' + today + '）'))
  assert.ok(text.includes('一共回头想过 3 次'))
  assert.ok(!text.includes('中间想过一次别的'))

  // 没有命中后记时，仍是原来的一行
  const plain = exp.renderTwoPart(exp.currentView(dir, row.id))
  assert.ok(plain.includes('后来你想过：' + long))
})

test('memory 命令和 recall 同一套防编造口径，也能凭后记找回', (t) => {
  const dir = tmp(t)
  for (const text of ['今天去码头看船', '茶凉了也没喝', '我觉得什么都没意思', '下雨没带伞']) exp.addExperience(dir, { text })
  assert.deepEqual(mem.recall(dir, '我昨天买了什么股票'), [])
  assert.deepEqual(exp.recall(dir, '我昨天买了什么股票'), [])
  const row = exp.addExperience(dir, { text: '那一夜' })
  exp.reviseExperience(dir, { id: row.id, thought: '她看见了邮船' })
  assert.deepEqual(mem.recall(dir, '邮船').map((r) => r.id), [row.id])
})

test('英文查询：按词匹配、不分大小写，虚词不把一切拉进来', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: 'I watched the rain at the station' })
  exp.addExperience(dir, { text: 'Read the lighthouse chapter' })
  assert.deepEqual(exp.recall(dir, 'the cat'), [])
  assert.deepEqual(exp.recall(dir, 'LIGHTHOUSE').map((r) => r.then.text), ['Read the lighthouse chapter'])
  assert.deepEqual(exp.recall(dir, 'rain').map((r) => r.then.text), ['I watched the rain at the station'])
})

test('醒来块：认不出是一对一的会话键，一律不给', (t) => {
  const data = tmp(t)
  fs.mkdirSync(memDir(data), { recursive: true })
  for (const key of ['group_1', 'qq:group:1', 'discord:channel:9', 'room-42']) {
    assert.equal(waking.buildWakingBlock(data, key), '', key)
    assert.equal(waking.consumeWaking(data, key), false, key)
  }
  for (const key of ['private_1', 'private:1', 'local:owner', 'local_owner']) {
    assert.match(waking.buildWakingBlock(data, key), /【醒来】/, key)
  }
  assert.match(waking.buildWakingBlock(data, 'qq:group:1', { allowGroup: true }), /【醒来】/)
})

test('睡前留言：目录还没有也能写', (t) => {
  const data = tmp(t)
  const row = waking.leaveNote(data, '明天把第三章读完')
  assert.equal(row.text, '明天把第三章读完')
  assert.ok(read(memDir(data), 'notes-to-tomorrow.jsonl').includes('明天把第三章读完'))
})

test('设置：文件坏了就拒绝保存，不把她改过的冲掉', (t) => {
  const data = tmp(t)
  settings.save(data, { ownTime: '22:00-23:00', myOwnKey: 1 })
  const f = path.join(memDir(data), 'self-settings.json')
  const broken = fs.readFileSync(f, 'utf8').slice(0, -3)
  fs.writeFileSync(f, broken)
  assert.throws(() => settings.save(data, { readingPerDay: 50 }), /设置文件损坏/)
  assert.equal(fs.readFileSync(f, 'utf8'), broken, '坏文件原样留着，等人来修')
  assert.equal(settings.load(data).ownTime, settings.DEFAULTS.ownTime, '读的时候仍按默认跑')
  assert.throws(() => settings.save(data, [1, 2]), /设置要是一个对象/)
})

for (const script of CLIS) {
  test('CLI --data：两个库各写标记，指定哪个就读哪个（' + script + '）', (t) => {
    const a = tmp(t)
    const b = tmp(t)
    const cwd = tmp(t)
    const run = (args, env = {}) => {
      const res = spawnSync(process.execPath, [path.join(root, script), ...args], {
        cwd, env: { ...process.env, WHALE_DATA_DIR: '', ...env }, encoding: 'utf8'
      })
      assert.equal(res.status, 0, res.stdout + res.stderr)
      return JSON.parse(res.stdout)
    }
    run(['write', '--data', a, '--text', '库A的标记'])
    run(['write', '--data=' + b, '--text', '库B的标记'])
    const texts = (res) => res.items.map((i) => i.text)
    assert.deepEqual(texts(run(['read', '--data=' + b, '--limit', '3'])), ['库B的标记'])
    assert.deepEqual(texts(run(['read', '--data', a, '--limit=3'])), ['库A的标记'])
    // --data 优先于环境变量
    assert.deepEqual(texts(run(['read', '--data=' + b], { WHALE_DATA_DIR: a })), ['库B的标记'])
    assert.deepEqual(texts(run(['read'], { WHALE_DATA_DIR: a })), ['库A的标记'])
  })
}
