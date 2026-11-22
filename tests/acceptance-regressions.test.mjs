import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove, tmpDir } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as settings from '../packages/core/lib/self-settings.js'
import { computeMetrics } from '../tools/metrics.mjs'
import { migrate as migrateLater, rollback as rollbackLater } from '../tools/migrate-later-events.mjs'
import { migrate as migrateRecall, rollback as rollbackRecall } from '../tools/migrate-recall-events.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

function tmp(t) {
  const dir = tmpDir('whale-accept-')
  t.after(() => safeRemove(dir))
  return dir
}
const memOf = (dataDir) => path.join(dataDir, 'plugin-data', 'biomimetic-memory')

// 外部验收 #1/#2：混合格式迁移后回滚，不能丢迁移前就存在的事件
for (const kind of ['later', 'recall']) {
  test('迁移回滚保留迁移前已有的 ' + kind + ' 事件', (t) => {
    const dataDir = tmp(t)
    const mem = memOf(dataDir)
    const legacy = exp.addExperience(mem, { text: '旧格式那条' })
    const modern = exp.addExperience(mem, { text: '新格式那条' })
    const file = path.join(mem, 'self-experience.jsonl')
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

    if (kind === 'later') {
      rows[0].later = [{ thought: '迁移前就有的后记', at: legacy.at }]
      assert.equal(exp.reviseExperience(mem, { id: modern.id, thought: '迁移前就有的事件' }).ok, true)
    } else {
      rows[0].recalls = 1
      assert.equal(exp.markRecalled(mem, modern.id), true)
    }
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

    const view = () => [legacy, modern].map(({ id }) => {
      const r = exp.currentView(mem, id)
      return kind === 'later' ? r.later.map((x) => x.thought) : r.recalls
    })
    const original = view()
    const migrate = kind === 'later' ? migrateLater : migrateRecall
    const rollback = kind === 'later' ? rollbackLater : rollbackRecall

    const change = migrate({ dataDir, apply: true })
    assert.equal(change.ok, true)
    assert.deepEqual(view(), original)
    assert.equal(rollback({ dataDir, backup: change.backup }).ok, true)
    assert.deepEqual(view(), original, '回滚后两条记录都要恢复')
  })
}

test('设置写入不会弄坏没有结尾换行的经历文件', (t) => {
  const dataDir = tmp(t)
  const mem = memOf(dataDir)
  const original = exp.addExperience(mem, { text: '设置前写的那条' })
  const file = path.join(mem, 'self-experience.jsonl')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').trimEnd(), 'utf8')

  settings.save(dataDir, { readingPerDay: 35 })
  assert.equal(settings.load(dataDir).readingPerDay, 35)
  const rows = exp.loadAll(mem)
  assert.ok(rows.some((r) => r.id === original.id))
  assert.ok(rows.some((r) => r.source === 'own-decision'))
})

test('同一分钟的旧格式记录各有稳定身份，修订只归到一条', (t) => {
  const dir = tmp(t)
  const rows = [
    { at: '2026-05-10T10:00:00Z', text: '第一条旧记录' },
    { at: '2026-05-10T10:00:50Z', text: '第二条旧记录' }
  ]
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  const loaded = exp.loadAll(dir)
  assert.notEqual(loaded[0].id, loaded[1].id)
  const secondId = loaded.find((r) => r.then.text === '第二条旧记录').id
  assert.equal(exp.reviseExperience(dir, { id: secondId, thought: '只改第二条' }).ok, true)
  assert.deepEqual(exp.loadAll(dir).map((r) => r.later.map((n) => n.thought)), [[], ['只改第二条']])
})

test('指标从合并视图算：API 改过主意就是改过', (t) => {
  const dataDir = tmp(t)
  const mem = memOf(dataDir)
  const { id } = exp.addExperience(mem, { text: '灯塔那一章' })
  assert.equal(exp.reviseExperience(mem, { id, thought: '又读了一遍' }).ok, true)
  const totals = computeMetrics(dataDir).experiences
  assert.equal(totals.total, 1)
  assert.equal(totals.revised, 1)
  assert.equal(totals.revisedRate, 100)
})

test('召回能凭后来才明白的词和原文锚找回当时', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, {
    text: '夜里又翻完一章',
    thought: '她是在等人',
    quote: { text: '潮汐终会归来', source: '《灯塔》' }
  })
  exp.reviseExperience(dir, { id: row.id, thought: '她是在等邮船' })

  const byLater = exp.recall(dir, '邮船', { limit: 1 })
  assert.equal(byLater[0].id, row.id)
  assert.ok(byLater[0].matchedIn.includes('later'))

  const byQuote = exp.recall(dir, '潮汐', { limit: 1 })
  assert.equal(byQuote[0].id, row.id)
  assert.ok(byQuote[0].matchedIn.includes('quote'))

  const byThen = exp.recall(dir, '夜里', { limit: 1 })
  assert.equal(byThen[0].id, row.id)
  assert.ok(byThen[0].matchedIn.includes('then'))
})

test('评测分母取全部用例，故意答错一条就会红', (t) => {
  const copy = tmp(t)
  for (const file of ['packages/core', 'tools/eval-recall.mjs', 'tests/fixtures/recall-cases.json']) {
    fs.cpSync(path.join(root, file), path.join(copy, file), { recursive: true })
  }
  const fixtureFile = path.join(copy, 'tests/fixtures/recall-cases.json')
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
  const evaluate = () => {
    const r = spawnSync(process.execPath, ['tools/eval-recall.mjs', '--json'], { cwd: copy, encoding: 'utf8' })
    return { status: r.status, report: JSON.parse(r.stdout) }
  }

  const baseline = evaluate()
  assert.equal(baseline.status, 0)
  assert.equal(baseline.report.cases, fixture.cases.length)

  const first = fixture.cases.find((c) => c.expect !== 'empty')
  const other = fixture.cases.find((c) => c.expect !== 'empty' && c.expect !== first.expect)
  first.expect = other.expect
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
  const broken = evaluate()

  assert.equal(broken.report.cases, fixture.cases.length)
  assert.equal(broken.report.pass, fixture.cases.length - 1)
  assert.ok(broken.report.top1Accuracy < 1)
  assert.notEqual(broken.status, 0)
})