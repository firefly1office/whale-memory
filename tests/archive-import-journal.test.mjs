// 导入断电窗口：rename(旧→备份) 与 rename(暂存→正式) 之间崩溃后，目录不能永久消失。
// 用真实子进程在第二次 rename 前/后 exit 来制造中间态，不靠 mock 进程内异常（那种会被 rollback 兜住）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { exportArchive, importArchive, importJournalPath, recoverImport } from '../packages/core/lib/archive.js'
import { safeRemove, tmpDir } from './_safety.mjs'

const ARCHIVE_MODULE = new URL('../packages/core/lib/archive.js', import.meta.url).href

function fixture(t) {
  const root = tmpDir('whale-import-crash-')
  t.after(() => safeRemove(root))
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  fs.mkdirSync(source)
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(source, 'a.txt'), 'new-a')
  fs.writeFileSync(path.join(source, 'b.txt'), 'new-b')
  fs.writeFileSync(path.join(target, 'original.txt'), 'old-memory')
  const archive = exportArchive(source, path.join(root, 'exports')).dir
  return { root, source, target, archive, journal: importJournalPath(target) }
}

// 子进程里真 import 一次，在指定位置调用 process.exit，绕过 finally/rollback，等价于断电。
function crashImport(t, { root, target, archive, mode }) {
  const rule = {
    // 备份已改名、正式目录尚未装回：target 消失
    'before-install': "if (String(from).includes('.import-stage-')) process.exit(77)",
    // 正式目录已装好、日志还没来得及清
    'after-install': "if (String(from).includes('.import-stage-')) { original(from, to); process.exit(78) }",
    // 日志已写、旧目录还没改名：target 还在
    'before-backup': "if (String(to).includes('.pre-import-')) process.exit(79)"
  }[mode]
  const script = path.join(root, `crash-${mode}.mjs`)
  fs.writeFileSync(script, [
    "import fs from 'node:fs'",
    `import { importArchive } from ${JSON.stringify(ARCHIVE_MODULE)}`,
    'const original = fs.renameSync',
    'fs.renameSync = (from, to) => {',
    '  ' + rule,
    '  return original(from, to)',
    '}',
    'importArchive(process.argv[2], process.argv[3], { force: true })'
  ].join('\n'))
  const result = spawnSync(process.execPath, [script, archive, target], { encoding: 'utf8' })
  assert.equal(result.signal, null)
  return result
}

test('崩在两次 rename 之间：留下可恢复日志，recoverImport 把备份装回原位', (t) => {
  const { target, archive, journal } = fixture(t)
  const crashed = crashImport(t, { root: path.dirname(target), target, archive, mode: 'before-install' })
  assert.equal(crashed.status, 77)

  assert.equal(fs.existsSync(target), false, '这正是要修的中间态：记忆目录消失了')
  const info = JSON.parse(fs.readFileSync(journal, 'utf8'))
  assert.equal(info.format, 'whale-memory-import-journal')
  assert.equal(path.resolve(info.target), path.resolve(target))
  assert.ok(fs.existsSync(info.backup), '备份目录要在')
  assert.ok(fs.existsSync(info.stage), '暂存目录要在')

  const recovered = recoverImport(target)
  assert.equal(recovered.recovered, true)
  assert.equal(recovered.action, 'restored-backup')
  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
  assert.equal(fs.existsSync(journal), false, '恢复后日志要清掉')
  assert.equal(fs.existsSync(info.stage), false, '恢复后暂存目录要清掉')
})

test('下一次 import 自动恢复断电现场，然后正常导入', (t) => {
  const { root, target, archive, journal } = fixture(t)
  assert.equal(crashImport(t, { root, target, archive, mode: 'before-install' }).status, 77)
  assert.equal(fs.existsSync(target), false)

  const result = importArchive(archive, target, { force: true })
  assert.equal(result.ok, true)
  assert.equal(result.recovered, true, '应报告这次导入前做了自动恢复')
  assert.equal(result.recoveredFrom, 'restored-backup')
  assert.equal(fs.readFileSync(path.join(target, 'a.txt'), 'utf8'), 'new-a')
  assert.equal(fs.readFileSync(path.join(target, 'b.txt'), 'utf8'), 'new-b')
  assert.equal(fs.existsSync(journal), false)
  assert.equal(fs.readFileSync(path.join(result.backup, 'original.txt'), 'utf8'), 'old-memory', '旧数据仍能从备份找回')
})

test('崩在装好之后：保留新目录，只清日志，旧的备份仍可回退', (t) => {
  const { target, archive, journal } = fixture(t)
  assert.equal(crashImport(t, { root: path.dirname(target), target, archive, mode: 'after-install' }).status, 78)

  assert.equal(fs.readFileSync(path.join(target, 'a.txt'), 'utf8'), 'new-a')
  assert.ok(fs.existsSync(journal), '断电时日志还没清')
  const info = JSON.parse(fs.readFileSync(journal, 'utf8'))
  assert.ok(fs.existsSync(info.backup))
  assert.equal(fs.readFileSync(path.join(info.backup, 'original.txt'), 'utf8'), 'old-memory')

  const recovered = recoverImport(target)
  assert.equal(recovered.recovered, true)
  assert.equal(recovered.action, 'kept-installed')
  assert.equal(fs.readFileSync(path.join(target, 'a.txt'), 'utf8'), 'new-a')
  assert.equal(fs.existsSync(journal), false)
  assert.ok(fs.existsSync(info.backup), '装好之后备份要留着，方便人工回退')
})

test('崩在搬旧目录之前：目标原样保留，清掉暂存目录与日志', (t) => {
  const { target, archive, journal } = fixture(t)
  assert.equal(crashImport(t, { root: path.dirname(target), target, archive, mode: 'before-backup' }).status, 79)

  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
  const info = JSON.parse(fs.readFileSync(journal, 'utf8'))
  assert.ok(fs.existsSync(info.stage))
  assert.equal(fs.existsSync(info.backup), false)

  const recovered = recoverImport(target)
  assert.equal(recovered.recovered, true)
  assert.equal(recovered.action, 'kept-target')
  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
  assert.equal(fs.existsSync(journal), false)
  assert.equal(fs.existsSync(info.stage), false)
})

test('日志被删也能按 pre-import/stage 目录兜底恢复', (t) => {
  const { target, archive, journal } = fixture(t)
  assert.equal(crashImport(t, { root: path.dirname(target), target, archive, mode: 'before-install' }).status, 77)
  fs.rmSync(journal, { force: true })

  const recovered = recoverImport(target)
  assert.equal(recovered.recovered, true)
  assert.equal(recovered.action, 'restored-backup-fallback')
  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
})

test('被篡改的日志不能把恢复指向目标目录之外', (t) => {
  const { root, target, journal } = fixture(t)
  const outside = path.join(root, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'do-not-touch')
  const staged = path.join(root, 'target.pre-import-legit')
  fs.renameSync(target, staged) // 制造 target 缺失；日志故意指向外面
  fs.writeFileSync(journal, JSON.stringify({
    format: 'whale-memory-import-journal',
    version: 1,
    target,
    backup: outside,
    stage: outside
  }), 'utf8')

  const recovered = recoverImport(target)
  assert.equal(recovered.recovered, false)
  assert.equal(recovered.action, 'missing-target-and-artifacts')
  assert.equal(fs.existsSync(target), false, '不能把外部目录搬进来')
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'do-not-touch')
  assert.ok(fs.existsSync(journal), '恢复不了时日志要留着当标识')
  fs.renameSync(staged, target) // 让 t.after 清理时目录结构正常
})

test('备份搬走后日志写盘失败：仍然把旧目录滚回来', (t) => {
  const { target, archive, journal } = fixture(t)
  const original = fs.renameSync
  let journalWrites = 0
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(to).endsWith('.import-journal.json')) {
      journalWrites += 1
      if (journalWrites === 2) throw Object.assign(new Error('simulated journal write failure'), { code: 'EIO' })
    }
    return original(from, to)
  })

  assert.throws(() => importArchive(archive, target, { force: true }), /simulated journal write failure/)
  assert.deepEqual(fs.readdirSync(target), ['original.txt'], '日志写失败也必须把旧目录滚回来')
  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
  assert.equal(fs.existsSync(journal), false)
  assert.equal(fs.readdirSync(path.dirname(target)).some((name) => name.includes('.import-stage-')), false)
})

test('另一个进程正在导入：不把它的备份/暂存当断电残留清掉', async (t) => {
  const { root, target, archive, journal } = fixture(t)
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore' })
  const exited = new Promise((resolve) => holder.on('close', resolve))
  t.after(async () => {
    if (holder.exitCode === null) holder.kill('SIGKILL')
    await exited
    safeRemove(root)
  })
  assert.ok(holder.pid)

  // 构造“另一个进程正在导入”的中间态：旧目录已搬到备份、暂存目录还在，日志主人活着
  const backup = target + '.pre-import-active-test'
  const stage = target + '.import-stage-active-test'
  fs.renameSync(target, backup)
  fs.mkdirSync(stage)
  fs.writeFileSync(path.join(stage, 'a.txt'), 'new-a')
  fs.writeFileSync(journal, JSON.stringify({
    format: 'whale-memory-import-journal',
    version: 1,
    target,
    backup,
    stage,
    pid: holder.pid,
    hostname: os.hostname(),
    updatedAt: new Date().toISOString()
  }), 'utf8')

  const recovered = recoverImport(target)
  assert.equal(recovered.action, 'in-progress')
  assert.equal(fs.existsSync(target), false)
  assert.ok(fs.existsSync(backup), '正在进行的导入，备份不能被搬走')
  assert.ok(fs.existsSync(stage), '正在进行的导入，暂存不能被清掉')
  assert.throws(() => importArchive(archive, target, { force: true }), /still running/)

  holder.kill('SIGKILL')
  await exited
  const after = recoverImport(target)
  assert.equal(after.recovered, true)
  assert.equal(after.action, 'restored-backup')
  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
  assert.equal(fs.existsSync(stage), false)
  assert.equal(fs.existsSync(journal), false)
})