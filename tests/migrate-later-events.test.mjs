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