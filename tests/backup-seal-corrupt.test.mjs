// 封存日志有坏行时：按字节备份、恢复演练、导入隔离目录都要能走通；
// 但宿主展示（严格读取）仍必须被挡住。
//
// 复审（3b0d7a4）：备份工具复制完两个文件后在统计经历数时抛 SEAL_EVENTS_CORRUPT，
// 留下没有 manifest.json 的目录；旧归档导入也在暂存目录同样抛错。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as archive from '../packages/core/lib/archive.js'
import { loadAll } from '../packages/core/lib/self-experience.js'
import { backup } from '../tools/backup.mjs'
import { restoreCheck } from '../tools/restore-check.mjs'
import { tmpDir } from './_safety.mjs'

function seedCorrupt() {
  const data = tmpDir('seal-corrupt-backup-')
  const mem = path.join(data, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })
  fs.writeFileSync(path.join(mem, 'self-experience.jsonl'), JSON.stringify({
    id: 'exp_seal', at: '2026-11-01T00:00:00.000Z', day: '2026-11-01',
    then: { text: '一件旧事', thought: '当时这么想' }, author: 'self', source: 'own-time'
  }) + '\n', 'utf8')
  fs.writeFileSync(path.join(mem, 'seal-events.jsonl'), '{"id":"exp_seal","action":"seal", 坏行\n', 'utf8')
  return { data, mem }
}

test('坏行时备份仍能完成，manifest 与字节都在', () => {
  const { data, mem } = seedCorrupt()
  const out = tmpDir('seal-corrupt-out-')
  const bk = backup({ data, out })

  assert.equal(bk.ok, true, JSON.stringify(bk))
  assert.ok(fs.existsSync(path.join(bk.dir, 'manifest.json')), '要有 manifest.json')
  const manifest = JSON.parse(fs.readFileSync(path.join(bk.dir, 'manifest.json'), 'utf8'))
  const names = manifest.files.map((f) => f.name).sort()
  assert.deepEqual(names, ['seal-events.jsonl', 'self-experience.jsonl'])
  // 坏行原样按字节备份
  assert.equal(
    fs.readFileSync(path.join(bk.dir, 'seal-events.jsonl')).compare(fs.readFileSync(path.join(mem, 'seal-events.jsonl'))),
    0
  )
})

test('坏行时恢复演练：判可恢复，并明确报告封存日志需要修复', () => {
  const { data } = seedCorrupt()
  const out = tmpDir('seal-corrupt-out-')
  const bk = backup({ data, out })
  const r = restoreCheck({ from: bk.dir, data })
  assert.equal(r.verdict, '可恢复，且与原数据一致', JSON.stringify(r.checks))
  assert.ok((r.notes || []).some((n) => String(n).includes('封存日志')), JSON.stringify(r.notes))
})

test('坏行时导入隔离目录：字节一致，严格读取仍被挡住', () => {
  const { data, mem } = seedCorrupt()
  const out = tmpDir('seal-corrupt-out-')
  const bk = backup({ data, out })
  const dest = path.join(tmpDir('seal-corrupt-dest-'), 'plugin-data', 'biomimetic-memory')

  archive.importArchive(bk.dir, dest)
  assert.equal(
    fs.readFileSync(path.join(dest, 'seal-events.jsonl')).compare(fs.readFileSync(path.join(mem, 'seal-events.jsonl'))),
    0,
    '恢复出来的封存日志应与归档一致'
  )
  assert.throws(() => loadAll(dest), /封存日志/, '宿主默认展示仍要 fail closed')
  assert.equal(loadAll(dest, { allowSealCorrupt: true }).length, 1, '工具可以按字节恢复并计数')
})
test('只剩备份（不给 --data）时：字节可恢复、未比对、坏行需修复', () => {
  const { data } = seedCorrupt()
  const out = tmpDir('seal-corrupt-out-')
  const bk = backup({ data, out })
  const r = restoreCheck({ from: bk.dir })
  assert.equal(r.ok, true, JSON.stringify(r.checks))
  assert.ok(r.verdict.includes('未做一致性比对'), r.verdict)
  assert.ok(r.verdict.includes('封存日志'), r.verdict)
})