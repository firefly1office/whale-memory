// 经历文件坏行与重复 id：
//   - 坏行必须可检测（badLines），展示路径 fail closed（loadAll / recall / currentView / 书 / CLI 都不许当 0 条）
//   - 按字节备份、恢复演练这类不展示内容的工具仍能读到（allowCorrupt / allowSealCorrupt）
//   - 事件日志读不出来也不能当空（以前 catch 成空数组：她会以为自己从没想起过）
//   - 同一份文件里重复的 id：事件只回填到最先写下的那条，不挂两条
//   - 同分钟的旧记录（旧 id 相同）在四万条规模下不能是 O(n²)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { renderBook } from '../packages/core/lib/book.js'
import * as exp from '../packages/core/lib/self-experience.js'
import { loadAll } from '../packages/core/lib/self-experience.js'
import { safeRemove, tmpDir } from './_safety.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLI = path.join(root, 'adapters', 'cli', 'memory-cli.mjs')

function tmp(t, prefix = 'whale-corrupt-') {
  const dir = tmpDir(prefix)
  t.after(() => safeRemove(dir))
  return dir
}

const row = (id, text, at = '2026-11-01T00:00:00.000Z') => JSON.stringify({
  id, at, day: String(at).slice(0, 10), author: 'self', source: 'own-time', kind: '其它', weight: 'normal',
  then: { text, scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: null },
  later: [], status: 'kept'
})
const put = (dir, file, lines) => fs.writeFileSync(path.join(dir, file), lines.join('\n') + '\n', 'utf8')

function brokenExperiences(t) {
  const dir = tmp(t)
  put(dir, 'self-experience.jsonl', [row('exp_ok', '翻到灯塔那一章'), '{"broken":'])
  return dir
}

test('坏行可检测：badLines 报数，loadAll 默认 fail closed 并带行数', (t) => {
  const dir = brokenExperiences(t)
  assert.equal(exp.badLines(dir), 1)
  assert.throws(() => loadAll(dir), (error) => {
    assert.equal(error.code, 'EXPERIENCE_CORRUPT')
    assert.equal(error.bad, 1)
    return /无法解析/.test(error.message)
  })
  // 显式展示路径一个都不能把"少了一条"装成"就这些"
  assert.throws(() => exp.recall(dir, '灯塔'), /无法解析/)
  assert.throws(() => exp.currentView(dir, 'exp_ok'), /无法解析/)
  assert.throws(() => renderBook(dir), /无法解析/)
  // 按字节备份 / 恢复演练这类工具仍能读（保住损坏现场，但不把结果当"可见"）
  assert.equal(exp.badLines(dir), 1)
  const raw = loadAll(dir, { allowCorrupt: true })
  assert.equal(raw.length, 1)
  assert.equal(raw[0].then.text, '翻到灯塔那一章')
  assert.equal(loadAll(dir, { allowSealCorrupt: true }).length, 1, '导出/恢复走的那条路同样放行')
})

test('坏行时不静默：写入照旧追加，坏行原样留在文件里', (t) => {
  const dir = brokenExperiences(t)
  const added = exp.addExperience(dir, { text: '新的一条' })
  const text = fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')
  assert.ok(text.includes('{"broken":'), '坏行不能被悄悄丢掉')
  assert.ok(text.includes(added.id), '新行要写进去')
  assert.equal(exp.badLines(dir), 1)
})

test('CLI 展示路径也 fail closed：read 报错而不是给空列表；doctor 不再报 ok', (t) => {
  const data = tmp(t, 'whale-corrupt-cli-')
  const mem = path.join(data, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })
  put(mem, 'self-experience.jsonl', [row('exp_ok', '翻到灯塔那一章'), '{"broken":'])

  const read = spawnSync(process.execPath, [CLI, 'read', '--data', data], { encoding: 'utf8' })
  const readJson = JSON.parse(read.stdout)
  assert.equal(readJson.ok, false, 'read 不能返回空列表当成"没有经历"')
  assert.match(String(readJson.error), /无法解析/)
  assert.notEqual(read.status, 0)

  const doc = spawnSync(process.execPath, [CLI, 'doctor', '--data', data], { encoding: 'utf8' })
  const docJson = JSON.parse(doc.stdout)
  assert.equal(docJson.ok, false, 'doctor 必须报出来')
  const check = docJson.checks.find((c) => c.name === '数据目录')
  assert.equal(check.ok, false)
  assert.match(check.detail, /无法解析/)
})

test('事件日志读不出来时不当空：只有"还没有这个文件"才算空', (t) => {
  const dir = tmp(t, 'whale-events-')
  exp.addExperience(dir, { text: '翻到灯塔那一章' })
  assert.equal(loadAll(dir).length, 1, '事件文件不存在时照常读经历')

  // recall-events.jsonl 是目录：读它必然失败（不是 ENOENT）
  fs.mkdirSync(path.join(dir, 'recall-events.jsonl'), { recursive: true })
  assert.throws(() => loadAll(dir), (error) => {
    assert.equal(error.code, 'EVENTS_UNREADABLE')
    return /事件日志读不出来/.test(error.message)
  })
  assert.throws(() => exp.recall(dir, '灯塔'), /事件日志读不出来/)
  // 按字节备份的路径仍然走得通（它只需要计数，不需要可信的合并视图）
  assert.equal(loadAll(dir, { allowCorrupt: true }).length, 1)
})

test('重复 id：想起次数与后记只回填到最先写下的那条', (t) => {
  const dir = tmp(t, 'whale-dup-')
  const same = row('exp_dup', '同一条经历')
  put(dir, 'self-experience.jsonl', [same, same])
  put(dir, 'recall-events.jsonl', [JSON.stringify({ id: 'exp_dup', at: '2026-11-02T00:00:00.000Z' })])
  put(dir, 'later-events.jsonl', [JSON.stringify({ id: 'exp_dup', at: '2026-11-02T00:00:00.000Z', day: '2026-11-02', thought: '后来的想法' })])

  const rows = loadAll(dir)
  assert.equal(rows.length, 2, '重复写下的那行还在（不删任何东西）')
  assert.equal(rows[0].recalls, 1)
  assert.equal(rows[1].recalls, undefined, '一次想起不该挂在两条上')
  assert.equal(rows[0].later.at(-1).thought, '后来的想法')
  assert.equal(rows[1].later.length, 0, '后记也只挂在最先写下的那条')
  assert.equal(rows[1].duplicateOf, 'exp_dup')
  // 指路（出处 / 反向引用）仍然只指向那条
  assert.equal(exp.currentView(dir, 'exp_dup').recalls, 1)
})

test('四万条同分钟的旧记录：归属是 O(n) 而不是 O(n²)', (t) => {
  const dir = tmp(t, 'whale-legacy-perf-')
  const n = 40000
  const lines = []
  for (let i = 0; i < n; i++) lines.push(JSON.stringify({ at: '2026-05-10T10:00:00Z', text: '旧记录 ' + i }))
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), lines.join('\n') + '\n', 'utf8')

  const started = Date.now()
  const rows = loadAll(dir)
  const elapsed = Date.now() - started
  assert.equal(rows.length, n)
  // 旧实现用 [...旧数组, id] 认领同一个旧 id，四万条要 7 秒以上；现在是毫秒级。
  // 留很宽的余量给慢机器，只把"退化成平方"挡在门外。
  assert.ok(elapsed < 5000, '四万条旧记录读了 ' + elapsed + 'ms，疑似又退化成 O(n²)')
})