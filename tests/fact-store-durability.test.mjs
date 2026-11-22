// 事实卡落盘：并发写不丢、崩溃不毁库、临时文件不残留。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { loadFacts, saveFacts } from '../packages/core/lib/fact-store.js'
import { safeRemove, tmpDir } from './_safety.mjs'

const STORE_MODULE = new URL('../packages/core/lib/fact-store.js', import.meta.url).href
const FILE = 'fact-cards.jsonl'

function runChild(args) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('child exited with ' + code + ': ' + stderr))
    })
  })
}

function tempFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith(FILE + '.tmp-'))
}

test('并发进程同时写：所有事实都在，不互相覆盖', async (t) => {
  const dir = tmpDir('facts-concurrent-')
  t.after(() => safeRemove(dir))
  const script = path.join(dir, 'writer.mjs')
  fs.writeFileSync(script, [
    `import { saveFacts } from ${JSON.stringify(STORE_MODULE)}`,
    'saveFacts(process.argv[2], [{ kind: \'like\', value: process.argv[3], subject: \'Leo\', chatKey: \'private:leo\', ts: 1000 }])'
  ].join('\n'))

  const values = ['咖啡', '火锅', '黄焖鸡', '香菜', '鲸舟', '灯塔']
  await Promise.all(values.map((value) => runChild([script, dir, value])))

  const rows = loadFacts(dir)
  assert.equal(rows.length, values.length, '并发写丢事实：' + JSON.stringify(rows.map((r) => r.value)))
  assert.deepEqual(rows.map((r) => r.value).sort(), [...values].sort())
  assert.equal(fs.existsSync(path.join(dir, FILE + '.lock')), false, '写完后锁目录不能残留')
  assert.deepEqual(tempFiles(dir), [], '写完后不能残留临时文件')
})

test('写到一半进程崩溃：正式文件还是旧内容，下次写入能自动清理并继续', (t) => {
  const dir = tmpDir('facts-crash-')
  t.after(() => safeRemove(dir))
  saveFacts(dir, [{ kind: 'like', value: '旧事实', subject: 'Leo', ts: 1000 }])
  const file = path.join(dir, FILE)
  const before = fs.readFileSync(file)

  const script = path.join(dir, 'crasher.mjs')
  fs.writeFileSync(script, [
    "import fs from 'node:fs'",
    `import { saveFacts } from ${JSON.stringify(STORE_MODULE)}`,
    'const [dirPath, value] = process.argv.slice(2)',
    'const original = fs.renameSync',
    'fs.renameSync = (from, to) => {',
    `  if (String(to).endsWith(${JSON.stringify(FILE)})) process.exit(23)`,
    '  return original(from, to)',
    '}',
    "saveFacts(dirPath, [{ kind: 'like', value, subject: 'Leo', ts: 2000 }])"
  ].join('\n'))

  const crashed = spawnSync(process.execPath, [script, dir, '新事实'], { encoding: 'utf8' })
  assert.equal(crashed.status, 23, '子进程应该死在 rename 之前')
  assert.deepEqual(fs.readFileSync(file), before, '崩溃后正式文件必须还是旧的完整内容')
  assert.deepEqual(loadFacts(dir).map((row) => row.value), ['旧事实'])
  assert.ok(fs.existsSync(path.join(dir, FILE + '.lock')), '崩溃后锁目录留着（等下一次回收）')
  assert.ok(tempFiles(dir).length > 0, '崩溃点应该留下临时文件')

  saveFacts(dir, [{ kind: 'like', value: '新事实', subject: 'Leo', ts: 2000 }])
  assert.deepEqual(loadFacts(dir).map((row) => row.value).sort(), ['新事实', '旧事实'].sort())
  assert.deepEqual(tempFiles(dir), [], '下一次拿到锁后要清掉上次的临时文件')
  assert.equal(fs.existsSync(path.join(dir, FILE + '.lock')), false)
})

test('rename 失败：旧文件不被破坏，也不留临时文件', (t) => {
  const dir = tmpDir('facts-rename-')
  t.after(() => safeRemove(dir))
  saveFacts(dir, [{ kind: 'like', value: '旧事实', ts: 1000 }])
  const file = path.join(dir, FILE)
  const before = fs.readFileSync(file)

  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('simulated power loss'), { code: 'EIO' }) })
  assert.throws(() => saveFacts(dir, [{ kind: 'like', value: '新事实', ts: 2000 }]), /simulated power loss/)
  assert.deepEqual(fs.readFileSync(file), before)
  assert.deepEqual(tempFiles(dir), [])
})

test('fsync 失败：旧文件不被破坏，也不留临时文件', (t) => {
  const dir = tmpDir('facts-fsync-')
  t.after(() => safeRemove(dir))
  saveFacts(dir, [{ kind: 'like', value: '旧事实', ts: 1000 }])
  const file = path.join(dir, FILE)
  const before = fs.readFileSync(file)

  t.mock.method(fs, 'fsyncSync', () => { throw new Error('simulated fsync failure') })
  assert.throws(() => saveFacts(dir, [{ kind: 'like', value: '新事实', ts: 2000 }]), /simulated fsync failure/)
  assert.deepEqual(fs.readFileSync(file), before)
  assert.deepEqual(tempFiles(dir), [])
})