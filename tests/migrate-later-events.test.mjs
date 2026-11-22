// 旧后记迁移：成功要原样保留字段，失败不能留下半份写入。
//
// 审核（000cfdc）：第一组带 ID 的迁移返回 ok:true，但 feeling 从 ["calm"] 变成缺失；
// 第二组混合无 ID 的旧经历，迁移失败、只恢复经历文件，事件文件里的有效项还在，
// 带 ID 的那条后记从 1 条变成 2 条。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { migrate } from '../tools/migrate-later-events.mjs'
import { eventsFile } from '../packages/core/lib/later-events.js'
import { loadAll } from '../packages/core/lib/self-experience.js'
import { changedSince } from '../packages/core/lib/changed.js'
import { tmpDir } from './_safety.mjs'

function seed(rows) {
  const dataDir = tmpDir('migrate-')
  const dir = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  return { dataDir, dir }
}

test('成功迁移：feeling / reason 原样保留，行内 later 清掉', () => {
  const row = {
    id: 'exp_1',
    at: '2026-11-01T10:00:00.000Z',
    day: '2026-11-01',
    then: { text: '读完灯塔', thought: '守灯人怕黑' },
    later: [
      { at: '2026-11-03T10:00:00.000Z', thought: '她在留灯', reason: '又读了一遍', feeling: ['calm', 'warm'] }
    ]
  }
  const { dataDir, dir } = seed([row])
  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.eventsCreated, 1)

  const loaded = loadAll(dir).find((r) => r.id === 'exp_1')
  assert.equal(loaded.later.length, 1)
  assert.equal(loaded.later[0].thought, '她在留灯')
  assert.deepEqual(loaded.later[0].feeling, ['calm', 'warm'], 'feeling 不能丢')
  assert.equal(loaded.later[0].reason, '又读了一遍')

  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8').trim())
  assert.equal('later' in raw, false, '行内 later 应清掉')
})

test('有无 ID 混合时整批拒绝，两份文件都不动', () => {
  const rows = [
    { id: 'exp_ok', day: '2026-11-01', then: { text: 'A', thought: '旧' }, later: [{ at: '2026-11-02T00:00:00.000Z', thought: '新' }] },
    { day: '2026-11-02', then: { text: 'B', thought: '旧' }, later: [{ at: '2026-11-03T00:00:00.000Z', thought: '新' }] }
  ]
  const { dataDir, dir } = seed(rows)
  const expBefore = fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')
  const evBefore = fs.existsSync(eventsFile(dir)) ? fs.readFileSync(eventsFile(dir), 'utf8') : null

  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, false)
  assert.match(out.error, /没有 id/)
  assert.equal(out.invalid.length, 1)

  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8'), expBefore, '经历文件不该变')
  const evAfter = fs.existsSync(eventsFile(dir)) ? fs.readFileSync(eventsFile(dir), 'utf8') : null
  assert.equal(evAfter, evBefore, '事件文件不该变')
})

test('重复跑迁移不会叠加后记', () => {
  const rows = [{ id: 'exp_2', day: '2026-11-01', then: { text: 'A', thought: '旧' }, later: [{ at: '2026-11-02T00:00:00.000Z', thought: '新' }] }]
  const { dataDir, dir } = seed(rows)
  assert.equal(migrate({ dataDir, apply: true }).ok, true)
  const again = migrate({ dataDir, apply: true })
  assert.equal(again.ok, true)
  assert.equal(again.eventsCreated, 0, '第二次没有可迁移的行内 later')
  const loaded = loadAll(dir).find((r) => r.id === 'exp_2')
  assert.equal(loaded.later.length, 1, '不该变成 2 条')
})
test('第二次改名抛 EIO：两份文件都回滚，重试后不重复', () => {
  const rows = [{ id: 'exp_io', day: '2026-11-01', then: { text: 'A', thought: '旧' }, later: [{ at: '2026-11-02T00:00:00.000Z', thought: '新', feeling: ['calm'] }] }]
  const { dataDir, dir } = seed(rows)
  const expFile = path.join(dir, 'self-experience.jsonl')
  const beforeExp = fs.readFileSync(expFile)
  const evFile = eventsFile(dir)
  const beforeEv = fs.existsSync(evFile) ? fs.readFileSync(evFile) : null

  // 第一次 rename 是事件文件，第二次是经历文件——让第二次抛 EIO
  const original = fs.renameSync
  let calls = 0
  fs.renameSync = (...args) => {
    calls += 1
    if (calls === 2) { const e = new Error('EIO'); e.code = 'EIO'; throw e }
    return original(...args)
  }
  let failed
  try { failed = migrate({ dataDir, apply: true }) } finally { fs.renameSync = original }

  assert.equal(failed.ok, false, JSON.stringify(failed))
  assert.equal(fs.readFileSync(expFile).compare(beforeExp), 0, '经历文件要恢复原样')
  const evNow = fs.existsSync(evFile) ? fs.readFileSync(evFile) : null
  assert.equal(evNow ? evNow.compare(beforeEv) : null, beforeEv ? 0 : null, '事件文件要恢复原样')

  const retry = migrate({ dataDir, apply: true })
  assert.equal(retry.ok, true, JSON.stringify(retry))
  const loaded = loadAll(dir).find((r) => r.id === 'exp_io')
  assert.equal(loaded.later.length, 1, '重试后不能变成 2 条')
  assert.deepEqual(loaded.later[0].feeling, ['calm'])
})
test('经历文件读不出来（非 ENOENT）：迁移返回失败，不报成功 0 条', () => {
  const dir = tmpDir('migrate-eacces-')
  const mem = path.join(dir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })
  const file = path.join(mem, 'self-experience.jsonl')
  fs.writeFileSync(file, JSON.stringify({ id: 'x', day: '2026-11-01', then: { text: 'A', thought: '旧' } }) + '\n', 'utf8')

  const original = fs.readFileSync
  fs.readFileSync = (...args) => {
    if (String(args[0]) === file) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e }
    return original(...args)
  }
  let out
  try { out = migrate({ dataDir: dir, apply: true }) } finally { fs.readFileSync = original }

  assert.equal(out.ok, false, JSON.stringify(out))
  assert.match(out.error, /经历文件读不出来/)
})
test('两条相同行内后记 + 一条已有副本（有迁移回执）：只抵扣一条，另一条要迁移过去', () => {
  const later = { at: '2026-11-02T00:00:00.000Z', day: '2026-11-02', thought: '新', reason: '' }
  const rows = [{ id: 'exp_dup', day: '2026-11-01', then: { text: 'A', thought: '旧' }, later: [later, { ...later }] }]
  const { dataDir, dir } = seed(rows)
  const ev = eventsFile(dir)
  const existing = { id: 'exp_dup', ...later }
  fs.writeFileSync(ev, JSON.stringify(existing) + '\n', 'utf8')
  // 回执：这条事件是上次迁移写下的副本
  fs.writeFileSync(path.join(dir, 'later-events-migration-receipt.json'), JSON.stringify({ version: 1, events: [existing] }) + '\n', 'utf8')

  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.eventsMatched, 1)
  assert.equal(out.eventsCreated, 1)
  const loaded = loadAll(dir).find((r) => r.id === 'exp_dup')
  assert.equal(loaded.later.length, 2, '两条都要在')
})

test('同 id/时间/想法但自然日不同：不能被抵扣掉', () => {
  const rows = [{ id: 'exp_day', day: '2026-11-01', then: { text: 'A', thought: '旧' }, later: [{ at: '2026-11-02T00:00:00.000Z', day: '2026-11-09', thought: '新' }] }]
  const { dataDir, dir } = seed(rows)
  const ev = eventsFile(dir)
  fs.writeFileSync(ev, JSON.stringify({ id: 'exp_day', at: '2026-11-02T00:00:00.000Z', day: '2026-11-02', thought: '新', reason: '' }) + '\n', 'utf8')

  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.eventsCreated, 1)
  const loaded = loadAll(dir).find((r) => r.id === 'exp_day')
  assert.equal(loaded.later.length, 2)
  assert.ok(loaded.later.some((l) => l.day === '2026-11-09'))
})

test('事件文件原本是零字节：回滚后仍是零字节文件，不是消失', () => {
  const rows = [{ id: 'exp_empty', day: '2026-11-01', then: { text: 'A', thought: '旧' }, later: [{ at: '2026-11-02T00:00:00.000Z', thought: '新' }] }]
  const { dataDir, dir } = seed(rows)
  const ev = eventsFile(dir)
  fs.writeFileSync(ev, '', 'utf8')
  assert.equal(fs.statSync(ev).size, 0)

  const original = fs.renameSync
  let calls = 0
  fs.renameSync = (...args) => {
    calls += 1
    if (calls === 2) { const e = new Error('EIO'); e.code = 'EIO'; throw e }
    return original(...args)
  }
  let out
  try { out = migrate({ dataDir, apply: true }) } finally { fs.renameSync = original }

  assert.equal(out.ok, false)
  assert.ok(fs.existsSync(ev), '零字节事件文件不能被删掉')
  assert.equal(fs.statSync(ev).size, 0)
  assert.equal(out.restored.events, true)
})
test('同一时间的两条后记：迁移后"现在怎么想"不变', () => {
  const at = '2026-11-02T00:00:00.000Z'
  const rows = [{
    id: 'exp_order',
    day: '2026-11-01',
    then: { text: 'A', thought: '最初' },
    later: [{ at, day: '2026-11-02', thought: '行内后写' }]
  }]
  const { dataDir, dir } = seed(rows)
  const ev = eventsFile(dir)
  fs.writeFileSync(ev, JSON.stringify({ id: 'exp_order', at, day: '2026-11-02', thought: '事件里那条', reason: '' }) + '\n', 'utf8')

  const before = changedSince(dir, { days: 3650 })
  assert.equal(before.length, 1)
  assert.equal(before[0].now, '事件里那条', '迁移前当前想法应是事件里那条')

  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, true, JSON.stringify(out))

  const after = changedSince(dir, { days: 3650 })
  assert.equal(after.length, 1)
  assert.equal(after[0].now, '事件里那条', '迁移后当前想法不能被换掉')
})

test('旧 ID（formerId）上的后记：迁移不被误判缺条', () => {
  const rows = [{
    id: 'exp_new',
    formerId: 'old_123',
    day: '2026-11-01',
    then: { text: 'A', thought: '最初' },
    later: [{ at: '2026-11-02T00:00:00.000Z', day: '2026-11-02', thought: '新想法' }]
  }]
  const { dataDir, dir } = seed(rows)
  const legacy = { id: 'old_123', at: '2026-11-02T00:00:00.000Z', day: '2026-11-02', thought: '新想法', reason: '' }
  fs.writeFileSync(eventsFile(dir), JSON.stringify(legacy) + '\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'later-events-migration-receipt.json'), JSON.stringify({ version: 1, events: [legacy] }) + '\n', 'utf8')

  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.eventsMatched, 1)
  assert.equal(out.eventsCreated, 0)
  const loaded = loadAll(dir).find((r) => r.id === 'exp_new')
  assert.equal(loaded.later.length, 1)
})

test('没有迁移回执时：相同的行内后记与事件都保留，不吞任何一条', () => {
  const later = { at: '2026-11-02T00:00:00.000Z', day: '2026-11-02', thought: '同一条' }
  const rows = [{ id: 'exp_noreceipt', day: '2026-11-01', then: { text: 'A', thought: '旧' }, later: [{ ...later }] }]
  const { dataDir, dir } = seed(rows)
  fs.writeFileSync(eventsFile(dir), JSON.stringify({ id: 'exp_noreceipt', ...later, reason: '' }) + '\n', 'utf8')

  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.eventsMatched, 0, '没有回执不能抵扣')
  assert.equal(out.eventsCreated, 1)
  const loaded = loadAll(dir).find((r) => r.id === 'exp_noreceipt')
  assert.equal(loaded.later.length, 2, '来源不明时宁可留两条')
})

test('formerId 指向多条经历：写盘前拒绝，两份文件都不动', () => {
  const rows = [
    { id: 'exp_a', formerId: 'dup_alias', day: '2026-11-01', then: { text: 'A', thought: '旧 A' }, later: [{ at: '2026-11-02T00:00:00.000Z', thought: '新 A' }] },
    { id: 'exp_b', formerId: 'dup_alias', day: '2026-11-01', then: { text: 'B', thought: '旧 B' }, later: [{ at: '2026-11-03T00:00:00.000Z', thought: '新 B' }] }
  ]
  const { dataDir, dir } = seed(rows)
  const expFile = path.join(dir, 'self-experience.jsonl')
  const before = fs.readFileSync(expFile)
  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, false)
  assert.ok(Array.isArray(out.ambiguous), JSON.stringify(out))
  assert.equal(fs.readFileSync(expFile).compare(before), 0)
})

test('缺 at 的行内后记：整行保留，不迁移也不改历史视图', () => {
  const rows = [{
    id: 'exp_noat',
    day: '2026-11-01',
    then: { text: 'A', thought: '旧' },
    later: [{ thought: '不知道哪天的想法' }]
  }]
  const { dataDir, dir } = seed(rows)
  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.eventsCreated, 0)
  assert.ok((out.skipped || []).some((s) => s.id === 'exp_noat'))
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8').trim())
  assert.equal(raw.later.length, 1, '缺 at 的后记要留在原文件里')
})

test('formerId 撞上另一条的当前 id：写盘前拒绝', () => {
  const rows = [
    { id: 'X', day: '2026-11-01', then: { text: 'A', thought: '旧 A' }, later: [{ at: '2026-11-02T00:00:00.000Z', thought: '新 A' }] },
    { id: 'exp_b', formerId: 'X', day: '2026-11-01', then: { text: 'B', thought: '旧 B' }, later: [{ at: '2026-11-03T00:00:00.000Z', thought: '新 B' }] }
  ]
  const { dataDir, dir } = seed(rows)
  const before = fs.readFileSync(path.join(dir, 'self-experience.jsonl'))
  const out = migrate({ dataDir, apply: true })
  assert.equal(out.ok, false)
  assert.ok(Array.isArray(out.ambiguous), JSON.stringify(out))
  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl')).compare(before), 0)
})