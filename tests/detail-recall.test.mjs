import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { recallDetail, selfExperience } from '../packages/core/index.js'

const readFixture = (name) => JSON.parse(fs.readFileSync(new URL('../eval/' + name, import.meta.url)))
const cases = readFixture('detail-cases.json')
const holdout = readFixture('detail-holdout.json')
const strict = selfExperience.recall

function scenario(t, spec) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-detail-'))
  t.after(() => fs.rmSync(data, { recursive: true, force: true }))
  const dir = path.join(data, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(dir, { recursive: true })
  const texts = [...spec.records, '在茶馆喝水。桌面是蓝色，账单一共十元。', '替同学拿快递，外包装印着商标。']
  const rows = texts.map((text, i) => ({
    id: 'r' + i, at: '2026-01-01T08:00:00Z', day: '2026-01-01', then: { text },
    later: i === 0 && spec.later ? [{ at: '2026-02-01T08:00:00Z', thought: spec.later }] : []
  }))
  fs.writeFileSync(path.join(dir, 'self-experience.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'))
  if (spec.sealed) selfExperience.setSealed(dir, { id: 'r0', sealed: true, note: 'private' })
  return { data, dir, rows }
}
const snapshot = (dir) => fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))])

function check(t, spec) {
  const { dir, rows } = scenario(t, spec)
  const before = snapshot(dir)
  const args = { asOf: spec.asOf }
  const result = recallDetail(dir, spec.query, args)
  assert.deepEqual(recallDetail(dir, spec.query, args), result)
  assert.deepEqual(snapshot(dir), before)
  assert.equal(result.status, spec.status, spec.query)
  assert.equal(result.value, spec.value ?? null)
  if (spec.id) assert.ok(result.candidates.some(c => c.id === spec.id), spec.query)
  if (spec.status === 'unmatched') assert.deepEqual(result.candidates, [])
  assert.ok(result.candidates.length <= 3)
  for (const c of result.candidates) {
    const row = rows.find(r => r.id === c.id)
    for (const e of c.evidence) {
      const source = e.field === 'then.text' ? row.then : row.later.find(l => l.at === e.at)
      assert.ok((source.text || source.thought).includes(e.text))
    }
  }
  return { result, baseline: strict(dir, spec.query, args).some(r => r.id === 'r0') }
}

for (const [group, entries] of Object.entries(cases)) {
  test('detail recall / ' + group, (t) => {
    let baseline = 0
    for (const [query, first, extra] of entries) {
      const spec = { query, records: [first], status: 'related', id: 'r0' }
      if (group === 'complete') Object.assign(spec, { status: 'supported', value: extra })
      if (group === 'similar') Object.assign(spec, { status: 'ambiguous', records: [first, extra] })
      if (group === 'change') spec.later = extra
      if (group === 'premise' || group === 'boundary') Object.assign(spec, { status: 'unmatched', id: null })
      if (group === 'boundary') {
        spec.sealed = extra === 'seal'
        spec.asOf = spec.sealed ? '2026-01-02' : '2025-12-31'
      }
      const checked = check(t, spec)
      baseline += Number(checked.baseline)
      if (group === 'change') assert.ok(checked.result.candidates[0].evidence.some(e => e.text === extra))
    }
    if (group === 'missing') t.diagnostic('Missing detail: old strict top3 ' + baseline + '/' + entries.length + ', detail top3 ' + entries.length + '/' + entries.length)
  })
}

test('split event clues are a lead only, even when the roles are reversed', (t) => {
  const result = check(t, { query: '冬青寄给我的那本画册多少钱？',
    records: ['我把画册寄给了冬青，售价八元。'], status: 'related', id: 'r0' }).result
  assert.equal(result.candidates[0].match, 'terms')
  check(t, { query: '冬青寄给我的那本画册多少钱？', records: ['见到了冬青。下午寄画册给阿夏。'], status: 'unmatched' })
})

test('uncertain brand statements and contextualized claims are excerpts only', (t) => {
  check(t, { query: '信封是什么品牌', records: ['信封的品牌是待确认。'], status: 'related', id: 'r0' })
  const { dir } = scenario(t, { records: ['围巾是红色。'] })
  const file = path.join(dir, 'self-experience.jsonl')
  const row = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0])
  row.then.scene = '梦里看见一只乌鸦'
  row.then.quote = {text: '书里提到一张门票', source: '故事书'}
  fs.writeFileSync(file, JSON.stringify(row))
  assert.equal(recallDetail(dir, '围巾是什么颜色').status, 'related')
  assert.equal(recallDetail(dir, '乌鸦是什么颜色').candidates[0].evidence[0].field, 'then.scene')
  assert.equal(recallDetail(dir, '门票多少钱').candidates[0].evidence[0].source, '故事书')
})

test('detail recall / frozen validation', (t) => {
  for (const spec of holdout) check(t, spec)
})

test('detail recall / 中心词回退：带定语的说法也能找到', (t) => {
  for (const query of ['我织的那条围巾是什么颜色', '去年冬天织的围巾是什么颜色']) {
    check(t, { query, records: ['我织完了一条围巾。'], status: 'related', id: 'r0' })
  }
  check(t, { query: '我织的那条围巾是什么颜色', records: ['围巾是蓝色。'], status: 'supported', value: '蓝色', id: 'r0' })
})

test('detail CLI agrees with the public API in both distributions', (t) => {
  const { data, dir } = scenario(t, { records: ['围巾是蓝色。'] })
  const query = '围巾是什么颜色'
  for (const entry of ['adapters/cli/memory-cli.mjs', 'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs']) {
    const res = spawnSync(process.execPath, [entry, 'detail', '--query', query, '--data', data], { encoding: 'utf8', cwd: new URL('../', import.meta.url) })
    assert.equal(res.status, 0, res.stderr || res.stdout)
    assert.deepEqual(JSON.parse(res.stdout), recallDetail(dir, query))
  }
  for (const query of ['', ' ', 'a'.repeat(501)]) assert.throws(() => recallDetail(dir, query))
})
