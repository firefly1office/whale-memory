// N4 · 运维演练的冒烟测试：整条链能跑、10 步全绿、报告结构齐、字节残留为 0、临时目录清干净。
//
// 真正的现场演练就是跑 `node tools/ops-drill.mjs`（约 0.6 秒，全在系统临时目录里）；
// 这条用例守着"它别哪天悄悄坏掉/悄悄跳过某一步"。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { tmpDir, safeRemove } from './_safety.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const TOOL = path.join(REPO, 'tools/ops-drill.mjs')

test('N4：运维演练 10 步全绿——备份/恢复/擦除/体检/字节残留/截断检查都在，临时目录自动清掉', (t) => {
  const base = tmpDir('wm-n4-drill-')
  t.after(() => safeRemove(base))
  const out = path.join(base, 'report.json')
  const res = spawnSync(process.execPath, [TOOL, '--json', '--out=' + out], { encoding: 'utf8', timeout: 300000 })
  assert.equal(res.status, 0, '演练退出 ' + res.status + '：' + String(res.stderr || '').split('\n').slice(0, 6).join(' '))
  // --json 的 stdout 就是报告（不再混人读文案）
  const fromStdout = JSON.parse(res.stdout)
  assert.equal(fs.existsSync(out), true, '--out 要落一份 JSON')
  const report = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.equal(fromStdout.ok, true)
  assert.deepEqual(fromStdout.steps.map((s) => s.name), report.steps.map((s) => s.name))

  assert.equal(report.ok, true, '演练不该有失败步骤：' + JSON.stringify(report.steps.filter((s) => !s.ok)))
  assert.equal(report.verdict, '通过')
  assert.equal(report.steps.length, 10, '链条是 10 步')
  for (const step of report.steps) assert.equal(step.ok, true, step.name + '：' + step.detail)

  // 关键动作都在（名字里能认出来）
  const names = report.steps.map((s) => s.name).join(' ')
  for (const key of ['造数据', '备份', '恢复', '体检', '擦除', '按字节', '截断']) assert.match(names, new RegExp(key))

  // 两条被撤回的正文、以及"备份之后写的那条"，在记忆目录里按字节 0 命中
  assert.equal(report.byteSearch.erasedA_inMem, 0)
  assert.equal(report.byteSearch.erasedB_inMem, 0)
  assert.equal(report.byteSearch.postBackup_inMem, 0)
  // 备份包和 pre-import 副本里还在（契约 §6-1：擦除不追溯），报告要如实写出来
  assert.ok(report.byteSearch.backups > 0, '备份包不追溯，应该量得到')
  assert.ok(Array.isArray(report.findings) && report.findings.length >= 1, '已知边界要写进 findings，别静默')
  assert.ok(report.findings.every((f) => f.level && f.text), 'findings 要有 level / text')

  // 报告能贴给人看：备份信息与计数都在
  assert.ok(report.backup.files > 0 && report.backup.bytes > 0)
  assert.equal(report.countsAfterRestore.records, 11)

  // 全绿时不留临时垃圾（--keep 才留）
  assert.equal(fs.existsSync(report.dir.base), false, '全绿之后临时目录应该删掉')
})