// 恢复演练的文件范围：只比经历字段会漏掉日记、抽屉这类旁支文件。
//
// 审核（000cfdc）：导出后只在源目录新增一份日记，演练仍返回 ok:true 和
// "可恢复，且与原数据一致"；连原目录都不给时也得到同一句话。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { backup } from '../tools/backup.mjs'
import { restoreCheck } from '../tools/restore-check.mjs'
import { addExperience } from '../packages/core/lib/self-experience.js'
import { tmpDir } from './_safety.mjs'

function seed() {
  const data = tmpDir('restore-data-')
  const out = tmpDir('restore-out-')
  const mem = path.join(data, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })
  addExperience(mem, { text: '夜里翻完灯塔那章', thought: '守灯人怕黑' })
  fs.writeFileSync(path.join(mem, 'autobiography.jsonl'), JSON.stringify({ day: '2026-11-21', text: '一篇日记' }) + '\n', 'utf8')
  return { data, out, mem }
}

test('备份之后源目录多了一个文件 → 如实报差异，不再说"一致"', () => {
  const { data, out } = seed()
  const bk = backup({ data, out })
  fs.writeFileSync(path.join(data, 'plugin-data', 'biomimetic-memory', 'extra-diary.jsonl'), JSON.stringify({ day: '2026-11-22', text: '新写的一篇' }) + '\n', 'utf8')

  const r = restoreCheck({ from: bk.dir, data })
  assert.equal(r.verdict, '可恢复，但与原数据有差异')
  assert.ok(r.diffs.some((d) => String(d.field).includes('extra-diary.jsonl')), JSON.stringify(r.diffs))
})

test('没有原目录时只说演练通过，不声称"与原数据一致"', () => {
  const { data, out } = seed()
  const bk = backup({ data, out })
  const r = restoreCheck({ from: bk.dir })
  assert.equal(r.verdict, '可恢复（未提供原数据，未做一致性比对）')
  assert.ok(!/与原数据一致/.test(r.verdict))
})

test('原数据没变时仍然判一致', () => {
  const { data, out } = seed()
  const bk = backup({ data, out })
  const r = restoreCheck({ from: bk.dir, data })
  assert.equal(r.verdict, '可恢复，且与原数据一致', JSON.stringify(r.diffs || r.checks))
})
test('归档跳过的临时文件不算缺失（和导出范围一致）', () => {
  const { data, out, mem } = seed()
  fs.writeFileSync(path.join(mem, 'settings.json.tmp-123'), '{}', 'utf8')
  const bk = backup({ data, out })
  const r = restoreCheck({ from: bk.dir, data })
  assert.equal(r.verdict, '可恢复，且与原数据一致', JSON.stringify(r.diffs || r.checks))
})

test('原库读不了：不把备份判成不可恢复，只说未完成比对', () => {
  const { data, out, mem } = seed()
  const bk = backup({ data, out })
  const target = path.join(mem, 'autobiography.jsonl')
  const original = fs.readFileSync
  fs.readFileSync = (...args) => {
    if (String(args[0]) === target) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e }
    return original(...args)
  }
  let r
  try { r = restoreCheck({ from: bk.dir, data }) } finally { fs.readFileSync = original }

  assert.equal(r.verdict, '可恢复（原数据读取失败，未完成比对）', JSON.stringify(r.checks))
  assert.ok(!String(r.verdict).includes('不可恢复'))
})