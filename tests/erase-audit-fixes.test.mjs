// 阶段 4 复审修复的回归测试（0.26.2）。
//
// 覆盖三条必修与一条"定下来"：
// 1. 有 memory.sqlite 时，擦除后按原始字节搜整个目录，正文必须搜不到；
// 2. 恢复"擦除之前"的备份，不会把撤回记录与审计一起抹掉；
// 3. 记录行已经不在、但这次清掉了残留事件时，审计要留一条；
// 4. 共用旧 id 的条目被擦掉时，墓碑记下这个旧 id（读路径维持"对不上"，见文档）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { tmpDir, safeRemove } from './_safety.mjs'
import * as exp from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import * as tombstones from '../packages/core/lib/tombstones.js'
import * as audit from '../packages/core/lib/audit.js'
import * as laterEvents from '../packages/core/lib/later-events.js'
import { exportArchive, importArchive } from '../packages/core/lib/archive.js'
import { runDoctor } from '../tools/doctor.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const NEW = (t) => {
  const dir = tmpDir('whale-erase-fix-')
  t.after(() => safeRemove(dir))
  return dir
}

const linesOf = (dir, name) => {
  try { return fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter((l) => l.trim()) } catch { return [] }
}

// 按原始字节搜整个目录（含 sqlite / -wal / -shm）
function hasBytes(dir, needle) {
  const target = Buffer.from(needle, 'utf8')
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) { const hit = walk(full); if (hit) return hit; continue }
      let buf
      try { buf = fs.readFileSync(full) } catch { continue }
      if (buf.includes(target)) return full
    }
    return ''
  }
  return walk(dir)
}

// 把 JSONL 迁移进 sqlite（与线上同一条路径）
function migrate(dir) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/migrate-storage.mjs'), dir, '--write'], { encoding: 'utf8' })
  assert.equal(r.status, 0, 'migrate 应该成功：' + String(r.stdout || '') + String(r.stderr || ''))
}

sq('擦除：有 sqlite 时，正文/想法/后记/未完成/备注/联想理由在库文件里也搜不到', (t) => {
  const dir = NEW(t)
  const a = exp.addExperience(dir, { text: '薄荷糖MARK1 的约定', thought: '想法MARK2', unfinished: '未完成MARK3' })
  exp.reviseExperience(dir, { id: a.id, thought: '后记MARK4' })
  exp.setUnfinishedState(dir, { id: a.id, choice: 'shelved', note: '结案MARK5' })
  const b = exp.addExperience(dir, { text: '另一条经历' })
  exp.linkExperiences(dir, { from: a.id, to: b.id, reason: '联想MARK6' })
  migrate(dir)

  const res = eraseExperience(dir, { id: a.id, reason: '她要求忘掉', actor: 'self' })
  assert.equal(res.removed.sqlite, true, '这次擦除应该动了库')

  for (const marker of ['薄荷糖MARK1', '想法MARK2', '未完成MARK3', '后记MARK4', '结案MARK5', '联想MARK6']) {
    const hit = hasBytes(dir, marker) || false
    assert.equal(hit, false, marker + ' 还留在 ' + hit)
  }
})

test('恢复"擦除之前"的备份：撤回记录与审计不能被抹掉', (t) => {
  const dir = NEW(t)
  const out = NEW(t)
  const a = exp.addExperience(dir, { text: '会被撤回的一条' })
  exp.addExperience(dir, { text: '留着的一条' })

  const exported = exportArchive(dir, out)
  const archiveDir = typeof exported === 'string' ? exported : (exported && (exported.dir || exported.path)) || ''
  assert.ok(archiveDir, '导出应该返回目录')

  eraseExperience(dir, { id: a.id, reason: '她要求忘掉', actor: 'self' })
  assert.equal(tombstones.readAll(dir).rows.length, 1, '擦除后有一条墓碑')

  const imported = importArchive(archiveDir, dir, { force: true })
  assert.equal(imported.skippedTombstoned, 1, '恢复时应剔掉 1 条已撤回记录')

  // 恢复"擦除之前"的备份，不该把撤回过的经历带回来：她要求忘掉的，不能靠翻旧备份复活。
  assert.equal(exp.loadAll(dir).some((r) => r.id === a.id), false, '已撤回的记录不能被恢复带回来')
  const after = tombstones.readAll(dir)
  assert.equal(after.rows.length, 1, '墓碑不能被换掉')
  assert.equal(after.rows[0].id, a.id)

  const erases = audit.read(dir, { action: 'erase' })
  assert.ok(erases.length >= 1, '审计里的擦除记录也要留着')

  // 记录没回来，体检不该报"已撤回的 id 又出现"
  const report = runDoctor(dir)
  const check = report.checks.find((c) => c.name === '封存一致性')
  assert.equal(check.ok, true, '没有复活记录，体检应当全绿：' + JSON.stringify(check))
})

test('记录行已不在、但清掉了残留事件：审计要留一条', (t) => {
  const dir = NEW(t)
  const a = exp.addExperience(dir, { text: '崩溃后重跑的那一条' })
  laterEvents.append(dir, { id: a.id, thought: '残留后记' })

  // 模拟"删了记录、没来得及删事件就崩了"
  const kept = linesOf(dir, 'self-experience.jsonl').filter((line) => JSON.parse(line).id !== a.id)
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), kept.join('\n') + '\n', 'utf8')

  const res = eraseExperience(dir, { id: a.id, reason: '补删残留', actor: 'self' })
  assert.equal(res.alreadyGone, true)
  assert.equal(res.tombstone, false)
  assert.ok(Number(res.removed.later) >= 1, '残留后记被清掉了')
  assert.equal(linesOf(dir, 'later-events.jsonl').length, 0)

  const notes = audit.read(dir, { action: 'erase' })
  assert.ok(notes.some((row) => String(row.note || '') === 'already-gone-cleanup'), '清掉残留也要留审计')
})

test('共用旧 id：擦掉其中一条时，墓碑记下这个旧 id', (t) => {
  const dir = NEW(t)
  const at = '2020-01-01T10:00:00.000Z'
  // 两条 0.10 之前的记录，同一分钟 → 认领出同一个旧 id
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'),
    JSON.stringify({ at, text: '甲DELTA', thought: '甲的想法' }) + '\n' +
    JSON.stringify({ at, text: '乙EPSILON', thought: '乙的想法' }) + '\n', 'utf8')

  const rows = exp.loadAll(dir)
  assert.equal(rows.length, 2)
  // loadAll 遇到共用旧 id 会把 formerId 清掉（对不上就不归任何人），所以这里按规则自己算一遍
  const former = 'exp_legacy_' + at.replace(/\D/g, '').slice(0, 12)

  const res = eraseExperience(dir, { id: rows[0].id, reason: '只撤甲', actor: 'self' })
  const mark = tombstones.readAll(dir).rows.find((r) => r.id === rows[0].id)
  assert.ok(mark, '墓碑写下了')
  assert.ok(Array.isArray(mark.ambiguousIds) && mark.ambiguousIds.includes(former), '墓碑要记下共用的旧 id：' + JSON.stringify(mark.ambiguousIds))
  assert.equal(res.removed.records, 1)
  assert.equal(exp.loadAll(dir).length, 1, '乙还在')
})

test('共用旧 id：擦掉甲之后，写给甲的旧后记不会挂到乙名下（读路径）', (t) => {
  const dir = NEW(t)
  const at = '2020-01-01T10:00:00.000Z'
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'),
    JSON.stringify({ at, text: '甲DELTA' }) + '\n' +
    JSON.stringify({ at, text: '乙EPSILON' }) + '\n', 'utf8')
  const former = 'exp_legacy_' + at.replace(/\D/g, '').slice(0, 12)
  laterEvents.append(dir, { id: former, thought: '写给甲的旧后记GAMMA' })

  const rows = exp.loadAll(dir)
  assert.equal(rows.length, 2)
  // 擦除前：两条共用旧 id，谁都认领不了 → 后记两边都不显示（对不上）
  assert.deepEqual(rows.map((r) => r.later.length), [0, 0])

  eraseExperience(dir, { id: rows[0].id, reason: '只撤甲', actor: 'self' })

  const left = exp.loadAll(dir)
  assert.equal(left.length, 1, '乙还在')
  assert.deepEqual(left[0].later, [], '写给甲的旧后记不该挂到乙名下')
  assert.equal(JSON.stringify(left).includes('GAMMA'), false)
  // 事件本身还在盘上（旧 id 上的东西不归乙，也不该被乙的撤回带走）
  assert.equal(fs.readFileSync(path.join(dir, 'later-events.jsonl'), 'utf8').includes('GAMMA'), true)
})

test('已经撤回过、又被带回来的记录，还能再撤掉（不能返回"已撤回"却不删）', (t) => {
  const dir = NEW(t)
  const a = exp.addExperience(dir, { text: '会被带回来的一条BETA' })
  const raw = fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')

  eraseExperience(dir, { id: a.id, reason: '第一次撤回', actor: 'self' })
  assert.equal(exp.loadAll(dir).length, 0)

  // 模拟一份"擦除之前"的备份被手工恢复（不走 import，那条路现在会剔掉撤回记录）
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), raw, 'utf8')
  assert.equal(exp.loadAll(dir).length, 1, '记录确实被带回来了')

  const again = eraseExperience(dir, { id: a.id, reason: '再撤一次', actor: 'self' })
  assert.equal(again.resurrected, true, '这次是复活后重撤')
  assert.equal(again.alreadyGone, false, '不能谎报已撤回')
  assert.equal(exp.loadAll(dir).length, 0, '记录必须真的没了')
  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8').includes('BETA'), false)
  assert.equal(tombstones.readAll(dir).rows.length, 1, '墓碑仍只有一份')
  const notes = audit.read(dir, { action: 'erase' }).map((r) => String(r.note || ''))
  assert.ok(notes.includes('erase-resurrected'), '审计要记下这次是复活后重撤：' + JSON.stringify(notes))
})