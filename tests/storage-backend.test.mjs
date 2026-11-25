// 阶段 1：两个后端必须遵守同一份契约；迁移必须逐条对拍。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { openBackend } from '../packages/core/lib/storage/backend.js'
import { addExperience } from '../packages/core/lib/self-experience.js'

const repo = path.resolve(import.meta.dirname, '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wm-store-'))
const rec = (id, day = '2026-11-25') => ({ id, at: day + 'T10:00:00.000Z', day, then: { text: 't-' + id } })

for (const kind of ['file', 'sqlite']) {
  test(`${kind} 后端：写入能按顺序读回`, async () => {
    const dir = tmp()
    const b = await openBackend({ kind, dir })
    await b.append(rec('a'))
    await b.append(rec('b'))
    const rows = await b.all()
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b'])
    assert.equal(await b.count(), 2)
    await b.close()
  })

  test(`${kind} 后端：byId 取得到、取不到返回 null`, async () => {
    const dir = tmp()
    const b = await openBackend({ kind, dir })
    await b.append(rec('x'))
    assert.equal((await b.byId('x')).id, 'x')
    assert.equal(await b.byId('nope'), null)
    await b.close()
  })

  test(`${kind} 后端：空目录读回空数组`, async () => {
    const dir = tmp()
    const b = await openBackend({ kind, dir })
    assert.deepEqual(await b.all(), [])
    await b.close()
  })
}

test('sqlite 后端：同一个 id 写两次被拒绝（id 永不复用）', async () => {
  const dir = tmp()
  const b = await openBackend({ kind: 'sqlite', dir })
  await b.append(rec('dup'))
  await assert.rejects(() => b.append(rec('dup')), /id 已存在/)
  await b.close()
})

test('sqlite 后端：byDay 按本地日取', async () => {
  const dir = tmp()
  const b = await openBackend({ kind: 'sqlite', dir })
  await b.append(rec('d1', '2026-11-24'))
  await b.append(rec('d2', '2026-11-25'))
  assert.deepEqual((await b.byDay('2026-11-25')).map((r) => r.id), ['d2'])
  await b.close()
})

test('未知后端名直接报错，不静默降级', async () => {
  await assert.rejects(() => openBackend({ kind: 'postgres', dir: tmp() }), /未知的存储后端/)
})

test('迁移：JSONL → SQLite 逐条对拍一致，源文件不变', () => {
  const dir = tmp()
  // 用真实写入函数造数据，保证格式就是线上格式
  addExperience(dir, { text: '第一条经历' })
  addExperience(dir, { text: '第二条经历', feeling: ['平静'] })
  const before = fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')

  execFileSync(process.execPath, [path.join(repo, 'tools/migrate-storage.mjs'), dir, '--write'], { stdio: 'pipe' })
  assert.ok(fs.existsSync(path.join(dir, 'memory.sqlite')))
  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8'), before, '迁移不许改源文件')

  // 再跑一次 verify-only 也要过
  const out = execFileSync(process.execPath, [path.join(repo, 'tools/migrate-storage.mjs'), dir, '--verify-only'], { stdio: 'pipe' })
  assert.match(String(out), /逐条对拍通过/)
})

test('迁移：演练模式不写盘', () => {
  const dir = tmp()
  addExperience(dir, { text: '只演练' })
  const out = execFileSync(process.execPath, [path.join(repo, 'tools/migrate-storage.mjs'), dir], { stdio: 'pipe' })
  assert.match(String(out), /演练模式/)
  assert.equal(fs.existsSync(path.join(dir, 'memory.sqlite')), false)
})

test('迁移：目标已存在时拒绝覆盖', () => {
  const dir = tmp()
  addExperience(dir, { text: 'x' })
  execFileSync(process.execPath, [path.join(repo, 'tools/migrate-storage.mjs'), dir, '--write'], { stdio: 'pipe' })
  assert.throws(() => execFileSync(process.execPath, [path.join(repo, 'tools/migrate-storage.mjs'), dir, '--write'], { stdio: 'pipe' }))
})