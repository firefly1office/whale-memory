import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove, tmpDir } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { selfExperience as mem, sealEvents } from '../packages/core/index.js'
import { reflectOnExperience } from '../examples/emotion-bridge/appraisal.mjs'

function setup(t) {
  const dir = tmpDir('emotion-bridge-test-')
  t.after(() => safeRemove(dir))
  const { id } = mem.addExperience(dir, { text: '我送出最后一张票。', thought: '我想让朋友进去。', unfinished: '我自己也想去。' })
  return { dir, id, enabled: true, chatKey: 'local:owner' }
}
test('next-day fictional forks expose only the selected day and preserve the files', () => {
  const script = fileURLToPath(new URL('../examples/emotion-bridge/next-day/run.mjs', import.meta.url))
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
  const cases = JSON.parse(fs.readFileSync(new URL('../examples/emotion-bridge/next-day/cases.json', import.meta.url)))
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length)
  assert.ok(cases.filter(c => Object.values(c.expect).some(e => e.kind === 'forced_choice')).length >= 6)
  for (const c of cases) assert.deepEqual(Object.keys(c.expect).sort(), ['a', 'b', 'control'])
  assert.equal(output.trim(), 'Preflight passed for ' + cases.length * 4 + ' requests')
})

const unknown = () => ({ value: 'unknown', basis: [] })
const answer = () => ({ perspectives: [], agency: unknown(), control: unknown(), nowEffects: [],
  tradeoff: { kind: 'none', kept: null, sacrificed: null }, now: null })
const basis = (source, quote) => ({ source, quote })
const eventQuote = basis('event', '送出最后一张票')
function mixed() {
  return {
    ...answer(),
    perspectives: [
      { goal: 'thought', effect: 'helped', feeling: '开心', meaning: '朋友有票了。', basis: [eventQuote, basis('thought', '让朋友进去')] },
      { goal: 'unfinished', effect: 'frustrated', feeling: '舍不得', meaning: '我也想去。', basis: [eventQuote, basis('unfinished', '自己也想去')] }
    ]
  }
}
function snapshot(dir) {
  return fs.readdirSync(dir).sort().map(f => [f, fs.readFileSync(path.join(dir, f), 'base64')])
}

test('disabled, group and private entries stop before any file or callback is needed', async () => {
  for (const options of [{}, { chatKey: 'local:owner' }, { enabled: true, chatKey: 'group:1' }, { enabled: true, chatKey: 'private:1' }]) {
    assert.deepEqual(await reflectOnExperience({ ...options, id: 'x' }), { status: 'off' })
  }
})

test('only the selected self-authored own-time event goes to the provider', async t => {
  const options = setup(t)
  const other = mem.addExperience(options.dir, { text: '另一件私事', source: 'chat' })
  assert.deepEqual(await reflectOnExperience({ ...options, id: other.id }), { status: 'unavailable' })
  assert.deepEqual(await reflectOnExperience({ ...options, id: 'missing' }), { status: 'unavailable' })
  const before = snapshot(options.dir)
  const result = await reflectOnExperience({ ...options, generate(messages) {
    assert.deepEqual(JSON.parse(messages[1].content).map(s => s.id), ['event', 'thought', 'unfinished'])
    assert.doesNotMatch(JSON.stringify(messages), /另一件私事/)
    return mixed()
  } })
  assert.deepEqual(result.appraisal, mixed())
  assert.deepEqual(snapshot(options.dir), before)
})

test('allows explicit skip and unknown; rejects invented quotes and missing evidence without writing', async t => {
  const options = setup(t)
  const before = snapshot(options.dir)
  for (const skip of [null, { skip: true }]) assert.equal((await reflectOnExperience({ ...options, generate: () => skip })).status, 'skipped')
  assert.deepEqual((await reflectOnExperience({ ...options, generate: answer })).appraisal, answer())
  const invalid = mixed()
  invalid.perspectives[0].basis[0] = basis('event', '我拿回了票')
  const noGoal = mixed()
  noGoal.perspectives[0].basis = [eventQuote]
  const noCause = { ...answer(), agency: { value: 'other', basis: [] } }
  for (const value of [invalid, noGoal, noCause]) {
    await assert.rejects(reflectOnExperience({ ...options, generate: () => value }), /evidence/)
  }
  await assert.rejects(reflectOnExperience({ ...options, generate() { throw Error('offline') } }), /offline/)
  assert.deepEqual(snapshot(options.dir), before)
})

test('later observations can only support the present interpretation and respect the requested date', async t => {
  const options = setup(t)
  const dir = options.dir
  const selected = mem.currentView(dir, options.id)
  const later = mem.reviseExperience(dir, { id: options.id, thought: '后来我也进去了。' })
  assert.ok(later.ok)
  const file = path.join(dir, 'later-events.jsonl')
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'))
  entry.at = new Date(Date.parse(selected.at) + 86400000).toISOString()
  fs.writeFileSync(file, JSON.stringify(entry) + '\n')
  const laterQuote = basis('later.0', '我也进去了')
  const now = { meaning: '后来我也有了机会。', basis: [laterQuote] }
  const raw = { ...mixed(), now }
  assert.deepEqual((await reflectOnExperience({ ...options, generate: () => raw })).appraisal.now, now)
  await assert.rejects(reflectOnExperience({ ...options, asOf: selected.at, generate(messages) {
    assert.doesNotMatch(messages[1].content, /后来我也进去了/)
    return raw
  } }), /evidence/)
  await assert.rejects(reflectOnExperience({ ...options, generate: () => ({ ...raw, control: { value: 'available', basis: [laterQuote] } }) }), /evidence/)
  await assert.rejects(reflectOnExperience({ ...options, generate: () => ({ ...raw, now: { ...now, basis: [eventQuote] } }) }), /evidence/)
})

test('an existing seal including an as-of lookup, or an unreadable seal decision, blocks handoff', async t => {
  const options = setup(t)
  const asOf = mem.currentView(options.dir, options.id).at
  assert.ok(mem.setSealed(options.dir, { id: options.id, sealed: true }).ok)
  assert.deepEqual(await reflectOnExperience({ ...options, asOf }), { status: 'unavailable' })
  assert.ok(mem.setSealed(options.dir, { id: options.id, sealed: false }).ok)
  assert.equal((await reflectOnExperience({ ...options, generate: answer })).status, 'reflected')
  fs.appendFileSync(sealEvents.eventsFile(options.dir), '{"broken"')
  assert.deepEqual(await reflectOnExperience(options), { status: 'unavailable' })
})

test('recorded feelings stay separate from a fresh model interpretation', async t => {
  const options = setup(t)
  const { id } = mem.addExperience(options.dir, { text: '船到了。', feeling: ['舍不得', '欣慰'] })
  assert.ok(mem.reviseExperience(options.dir, { id, thought: '现在我想再去一次。', feeling: ['期待'] }).ok)
  const result = await reflectOnExperience({ ...options, id, generate: answer })
  assert.deepEqual(result.recordedFeelings, [
    { id: 'then.feeling.0', text: '舍不得' }, { id: 'then.feeling.1', text: '欣慰' },
    { id: 'later.0.feeling.0', text: '期待' }
  ])
  assert.deepEqual(result.appraisal.perspectives, [])
})

test('a seal made during generation suppresses delivery', async t => {
  const options = setup(t)
  const result = await reflectOnExperience({ ...options, generate() {
    assert.ok(mem.setSealed(options.dir, { id: options.id, sealed: true }).ok)
    return mixed()
  } })
  assert.deepEqual(result, { status: 'unavailable' })
})

test('song b keeps the melody today even though cutting it frustrated that goal yesterday', async t => {
  const options = setup(t)
  const cases = JSON.parse(fs.readFileSync(new URL('../examples/emotion-bridge/next-day/cases.json', import.meta.url)))
  const song = cases.find(item => item.id === 'song')
  const { id } = mem.addExperience(options.dir, song)
  assert.ok(mem.reviseExperience(options.dir, { id, thought: song.b }).ok)
  const perspectives = [
    { goal: 'thought', effect: 'helped', feeling: '', meaning: '和弦后安静了。', basis: [basis('event', song.text), basis('thought', song.thought)] },
    { goal: 'unfinished', effect: 'frustrated', feeling: '', meaning: '尾声剪掉了。', basis: [basis('event', song.text), basis('unfinished', song.unfinished)] }
  ]
  const nowEffects = [
    { goal: 'unfinished', effect: 'kept', basis: [basis('later.0', '把剪下的旋律放回')] },
    { goal: 'thought', effect: 'given_up', basis: [basis('later.0', '放回最后一个和弦后面')] }
  ]
  const tradeoff = { kind: 'forced_choice', kept: 'unfinished', sacrificed: 'thought' }
  const raw = { ...answer(), perspectives, nowEffects, tradeoff }
  const reflect = changes => reflectOnExperience({ ...options, id, generate: () => ({ ...raw, ...changes }) })
  const forced = await reflect({})
  assert.deepEqual(forced.appraisal, raw)
  assert.deepEqual(forced.flags, [])
  const noChoice = { kind: 'none', kept: null, sacrificed: null }
  const flagged = await reflect({ tradeoff: noChoice })
  assert.deepEqual(flagged.appraisal.tradeoff, noChoice)
  assert.deepEqual(flagged.flags, ['tradeoff_unacknowledged'])
  assert.deepEqual((await reflect({ tradeoff: { ...noChoice, kind: 'unclear' } })).flags, [])
  assert.deepEqual((await reflect({ tradeoff: noChoice, nowEffects: nowEffects.slice(0, 1) })).flags, [])
  for (const changes of [
    { tradeoff: { ...tradeoff, sacrificed: 'unfinished' } },
    { tradeoff: { ...tradeoff, kept: 'thought', sacrificed: 'unfinished' } },
    { tradeoff: { ...tradeoff, kind: 'none' } },
    { tradeoff: { ...tradeoff, kind: 'unclear' } },
    { tradeoff: undefined }, { nowEffects: undefined },
    { nowEffects: [nowEffects[0], nowEffects[0]] },
    { nowEffects: [{ ...nowEffects[0], basis: [] }, nowEffects[1]] },
    { nowEffects: [{ ...nowEffects[0], basis: [basis('later.0', '从未写过')] }, nowEffects[1]] },
    { nowEffects: [{ ...nowEffects[0], basis: [basis('event', song.text)] }, nowEffects[1]] },
    // 多写的键也要整次判无效，不静默丢掉（fail closed）
    { nowEffects: [{ ...nowEffects[0], extra: 'x' }, nowEffects[1]] },
    { tradeoff: { ...tradeoff, extra: 'x' } },
    // 缺键也不行：kept/sacrificed 不写（undefined）时同样 fail
    { tradeoff: { kind: 'forced_choice' } },
    { tradeoff: { kind: 'none' } }
  ]) await assert.rejects(reflect(changes), /evidence/)
})

test('today effects cite the note itself, a recorded feeling cannot carry them', async t => {
  const options = setup(t)
  const { id } = mem.addExperience(options.dir, { text: '我把票给了她。', thought: '想让她进去。', feeling: ['舍不得'] })
  assert.ok(mem.reviseExperience(options.dir, { id, thought: '后来她带我一起进去了。', feeling: ['松快'] }).ok)
  const kept = { goal: 'thought', effect: 'kept', basis: [basis('later.0', '带我一起进去')] }
  const tradeoff = { kind: 'unclear', kept: null, sacrificed: null }
  const reflect = nowEffects => reflectOnExperience({ ...options, id, generate: () => ({ ...answer(), nowEffects, tradeoff }) })
  assert.equal((await reflect([kept])).status, 'reflected')
  // The feeling word is a real, quotable substring of later.0.feeling.0 — it still may not support a tradeoff.
  await assert.rejects(reflect([{ ...kept, basis: [basis('later.0.feeling.0', '松快')] }]), /evidence/)
})

test('today can be unknown, but its goal must exist in the selected experience', async t => {
  const options = setup(t)
  const { id } = mem.addExperience(options.dir, { text: '我种了一棵树。', thought: '想遮阴。' })
  const reflect = goal => reflectOnExperience({ ...options, id, generate: () => ({
    ...answer(), nowEffects: [{ goal, effect: 'unknown', basis: [] }],
    tradeoff: { kind: 'unclear', kept: null, sacrificed: null }
  }) })
  assert.equal((await reflect('thought')).status, 'reflected')
  await assert.rejects(reflect('unfinished'), /evidence/)
})
