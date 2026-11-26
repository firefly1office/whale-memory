// 迁移演练脚本的测试：验的是「演练本身靠得住」——可重复、失败会被发现、只读真实数据。
// 真正的迁移语义在 tests/storage-backend.test.mjs；这里只测 tools/migrate-drill.mjs。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { addExperience, reviseExperience, setSealed } from '../packages/core/lib/self-experience.js'
import { sqliteAvailable } from '../packages/core/lib/sqlite-store.js'
import { tmpDir, safeRemove } from './_safety.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const DRILL = path.join(repo, 'tools', 'migrate-drill.mjs')
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

function runDrill(args) {
  const res = spawnSync(process.execPath, [DRILL, ...args], { encoding: 'utf8', timeout: 120000 })
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' }
}

function parseJson(res) {
  const lines = res.stdout.trim().split('\n').filter(Boolean)
  assert.ok(lines.length, '演练没有任何输出：' + res.stderr)
  try {
    return JSON.parse(lines[lines.length - 1])
  } catch {
    assert.fail('最后一行不是 JSON：' + lines[lines.length - 1])
  }
}

// 造一份 0.27.0 形态的样本（用 0.27.0 自己的 API 造，形状不是手写的）
function makeSample(dir) {
  const a = addExperience(dir, { text: '演练样本：海边走了一圈', feeling: ['平静'] })
  const b = addExperience(dir, { text: '演练样本：把灯修好了', weight: 'important' })
  reviseExperience(dir, { id: a.id, thought: '后来又想起来了' })
  setSealed(dir, { id: b.id, sealed: true, note: '先放着' })
  return { ids: [a.id, b.id] }
}

const skipIfNoSqlite = (t) => {
  if (sqliteAvailable()) return false
  t.diagnostic('skip: 拿不到 node:sqlite，迁移演练未执行')
  return true
}

test('迁移演练：自造数据跑完整四步，19 项断言全过，坏行/覆盖/过期都按预期拒绝', (t) => {
  if (skipIfNoSqlite(t)) return
  const work = tmpDir('wm-drill-selftest-')
  t.after(() => safeRemove(work))
  const res = runDrill(['--work', path.join(work, 'run1'), '--json'])
  assert.equal(res.status, 0, '演练失败：' + res.stderr.slice(-800))
  const out = parseJson(res)
  assert.equal(out.ok, true)
  assert.equal(out.failed, 0)
  assert.ok(out.checks >= 19, '断言数比 1.0 冻结时少（' + out.checks + '）——演练被削弱了')
  assert.deepEqual(out.cases.map((c) => c.cases), ['repeatable', 'corrupt-refused', 'refuse-overwrite'])
  const repeatable = out.cases.find((c) => c.cases === 'repeatable')
  assert.match(repeatable.digest, /^[0-9a-f]{64}$/)
  assert.equal(repeatable.records, 4, '两次迁移 + 源文件变了之后应该是 4 条')
})

test('迁移演练：同一份源数据连跑两次，结果摘要一致（可重复不是只在一次运行里成立）', (t) => {
  if (skipIfNoSqlite(t)) return
  const work = tmpDir('wm-drill-repeat-')
  t.after(() => safeRemove(work))
  // 摘要只对「同一份源数据」有意义：自造样本每次的时间戳/id 都不同，跨次本来就不可比，
  // 所以这里拿一份固定的样本当源，跑两次看摘要对不对得上。
  const seed = path.join(work, 'seed')
  fs.mkdirSync(seed, { recursive: true })
  makeSample(seed)
  const first = runDrill(['--from', seed, '--work', path.join(work, 'a'), '--json'])
  const second = runDrill(['--from', seed, '--work', path.join(work, 'b'), '--json'])
  assert.equal(first.status, 0, first.stderr.slice(-500))
  assert.equal(second.status, 0, second.stderr.slice(-500))
  const a = parseJson(first)
  const b = parseJson(second)
  assert.equal(a.cases.find((c) => c.cases === 'from-real').digest, b.cases.find((c) => c.cases === 'from-real').digest,
    '同一份源数据两次演练，内容摘要必须相同')
  const digestOf = (o) => o.cases.find((c) => c.cases === 'repeatable').digest
  assert.equal(digestOf(a), digestOf(b), '两次迁移的摘要也必须相同')
})

test('迁移演练：--from 只读真实目录——演练前后源目录逐字节不变', (t) => {
  if (skipIfNoSqlite(t)) return
  const work = tmpDir('wm-drill-from-')
  t.after(() => safeRemove(work))
  const seed = path.join(work, 'seed')
  fs.mkdirSync(seed, { recursive: true })
  makeSample(seed)
  const snapshot = () => Object.fromEntries(fs.readdirSync(seed).sort().map((f) => [f, sha(fs.readFileSync(path.join(seed, f)))]))

  const before = snapshot()
  const res = runDrill(['--from', seed, '--work', path.join(work, 'run'), '--json'])
  assert.equal(res.status, 0, '演练失败：' + res.stderr.slice(-800))
  const out = parseJson(res)
  assert.equal(out.sourceReadonly.changed.length, 0, '演练改动了源目录：' + out.sourceReadonly.changed.join('、'))
  assert.deepEqual(snapshot(), before, '源目录里每个文件的字节都必须和演练前一模一样')
  const fromReal = out.cases.find((c) => c.cases === 'from-real')
  assert.equal(fromReal.records, 2, '真实样本里 2 条记录，迁移后也要是 2 条')
  assert.equal(fromReal.events, 2, '一条后记 + 一条封存')
})

test('迁移演练：--from 指向不存在的目录 → 用法错（exit 3），不装没事', () => {
  const res = runDrill(['--from', path.join(repo, 'tests', '__不存在的目录__'), '--json'])
  assert.equal(res.status, 3)
})