import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { safeRemove } from './_safety.mjs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluateEmotion, projectEmotion, prepareContext, buildMessages, validateAppraisal, settle } from '../packages/emotion/index.js'
import { score, summarize } from '../examples/text-emotion/scoring.mjs'
import { context, cases } from '../examples/text-emotion/cases.mjs'

const quote = (source, text) => ({ source, quote: text })
function answer(input, kind = 'ordinary', relation = 'none') {
  return { interpretations: [{ kind, certainty: 'high', meaning: '测试用候选解释，不代表模型已理解。', emotions: [], basis: [quote('current', input.turn.text)] }], selected: 0,
    selfFeelings: [], relationship: { kind: relation, target: 'person', basis: relation === 'none' ? [] : [quote('current', input.turn.text)] } }
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-text-emotion-'))
  t.after(() => safeRemove(dir))
  const input = context('谢谢你，我会遵守我们的约定。')
  const run = (i = input, a = answer(i), extra = {}) => evaluateEmotion({ enabled: true, dir, input: i, generate: () => a, ...extra })
  const view = (opts = {}) => projectEmotion(dir, input, { now: 1001000, ...opts })
  return { dir, input, run, view, file: path.join(dir, 'emotion-events.jsonl') }
}

test('off has no I/O or callback', async () => {
  assert.deepEqual(await evaluateEmotion({ generate() { throw Error('must not call') } }), { status: 'off' })
})

test('context excludes other scopes, people, characters, future and hidden memories', () => {
  const input = context('现在的话', ['过去的话'], [['concern', '我在意的事']])
  for (const patch of [{ scope: 'elsewhere' }, { personId: 'someone-else' }, { characterId: 'other' }, { at: 1000001 }]) {
    input.history.push({ ...input.history[0], ...patch, text: 'PRIVATE_CANARY' })
    input.memories.push({ ...input.memories[0], ...patch, text: 'PRIVATE_CANARY' })
  }
  input.memories.push({ ...input.memories[0], visible: false, text: 'PRIVATE_CANARY' })
  const out = buildMessages(prepareContext(input))
  assert.doesNotMatch(out[1].content, /PRIVATE_CANARY/)
  assert.match(out[1].content, /过去的话/)
  assert.match(out[1].content, /我在意的事/)
})

test('duplicate source IDs, oversized turns and total context are rejected', () => {
  const input = context('现在', ['之前'])
  input.history[0].id = input.turn.id
  assert.throws(() => prepareContext(input), /duplicate/)
  assert.throws(() => prepareContext(context('字'.repeat(2001))), /oversized/)
  assert.throws(() => prepareContext(context('现在', Array(12).fill('字'.repeat(2000)))), /budget/)
})

test('ordinary chat and accepted joking do not change mood or relationship even if provider proposes a penalty', async t => {
  for (const kind of ['ordinary', 'playful', 'quotation']) {
    const x = setup(t)
    await x.run(x.input, answer(x.input, kind, 'betrayal'))
    assert.deepEqual(x.view().relationship, { trust: 0.5, closeness: 0.5, tension: 0 })
    assert.equal(x.view().mood, 0)
  }
})

test('ambiguous and low-confidence interpretations cannot settle relationship', async t => {
  const x = setup(t)
  for (const [i, selected, certainty] of [[1, null, 'high'], [2, 0, 'low'], [3, 0, 'medium']]) {
    const input = { ...x.input, turn: { ...x.input.turn, id: 't' + i, at: 1000000 + i } }
    const a = answer(input, 'hurt', 'betrayal'); a.selected = selected; a.interpretations[0].certainty = certainty
    await x.run(input, a)
  }
  assert.equal(x.view().relationship.trust, 0.5)
})

test('sadness and gratitude coexist; negative feeling is not a relationship penalty', async t => {
  const x = setup(t)
  const input = context('画被雨淋坏了，我陪你重新画。', [], [['concern', '我珍惜这幅画，也珍惜朋友的帮助。']])
  const a = answer(input, 'mixed', 'care')
  const basis = [quote('current', input.turn.text), quote('memory:m0', input.memories[0].text)]
  a.selfFeelings = [
    { name: '难过', valence: -0.8, intensity: 0.6, meaning: '画损坏了。', basis },
    { name: '感谢', valence: 0.6, intensity: 0.4, meaning: '有人陪我。', basis }
  ]
  await x.run(input, a)
  const state = x.view({ now: input.turn.at })
  assert.equal(state.feelings.length, 2)
  assert.ok(state.mood < 0)
  assert.ok(state.relationship.trust > 0.5)
  assert.equal(state.relationship.tension, 0)
  assert.ok(Math.abs(x.view({ now: input.turn.at + 7200000 }).mood - state.mood / 2) < 0.00001)
  assert.deepEqual(x.view({ now: input.turn.at + 7200000 }).relationship, state.relationship)
})

test('unknown personal concern or invented evidence does not create state', async t => {
  const x = setup(t)
  const a = answer(x.input)
  a.selfFeelings = [{ name: '闷闷的', valence: -0.5, intensity: 0.6, meaning: '不明原因', basis: [quote('current', x.input.turn.text)] }]
  await assert.rejects(x.run(x.input, a), /personal concern/)
  a.selfFeelings = []; a.interpretations[0].basis[0].quote = '不存在的话'
  await assert.rejects(x.run(x.input, a), /Unsupported evidence/)
  assert.equal(fs.existsSync(x.file), false)
})

test('known boundary is required; friendship does not override it', async t => {
  const x = setup(t)
  const input = context('你又犯笨了哈哈', [], [['boundary', '不要叫我笨，我不喜欢。']])
  const a = answer(input, 'boundary', 'boundary_violation')
  await assert.rejects(x.run(input, a), /known boundary/)
  a.relationship.basis.push(quote('memory:m0', input.memories[0].text))
  a.selfFeelings = [{ name: '不舒服', valence: -0.4, intensity: 0.3, meaning: '已表达的边界被触碰。', basis: [...a.relationship.basis] }]
  await x.run(input, a)
  assert.ok(x.view().relationship.trust < 0.5)
  assert.equal(x.view().feelings[0].name, '不舒服')
})

test('third-party relationship claims are not charged to the current speaker', async t => {
  const x = setup(t)
  const a = answer(x.input, 'hurt', 'betrayal'); a.relationship.target = 'other'
  await x.run(x.input, a)
  assert.equal(x.view().relationship.trust, 0.5)
})

test('correction replays history rather than adding compensation; old as-of view survives', async t => {
  const x = setup(t)
  x.input.memories = context('unused', [], [['relationship', '我在意我们之间的信任。']]).memories
  const old = answer(x.input, 'hurt', 'betrayal')
  old.selfFeelings = [{ name: '难过', valence: -0.6, intensity: 0.5, meaning: '模拟误判造成的感受', basis: [quote('current', x.input.turn.text), quote('memory:m0', x.input.memories[0].text)] }]
  const first = await x.run(x.input, old)
  const beforeBytes = fs.readFileSync(x.file, 'utf8')
  const next = { ...x.input, turn: { id: 'next', at: 1000100, text: '我按约定来陪你一起完成了。' } }
  await x.run(next, answer(next, 'support', 'kept_promise'))
  const correction = { ...x.input, turn: { id: 'clarify', at: 1000200, text: '刚才是在说游戏角色，我没有说你。' } }
  await x.run(correction, answer(correction, 'quotation'), { supersedes: first.eventId })
  assert.deepEqual(x.view().relationship, { trust: 0.52, closeness: 0.51, tension: 0 })
  assert.equal(x.view({ now: 1000000 }).relationship.trust, 0.46)
  assert.ok(x.view({ now: 1000000 }).mood < 0)
  assert.equal(x.view().mood, 0)
  assert.ok(fs.readFileSync(x.file, 'utf8').startsWith(beforeBytes))
  assert.equal(x.view().events, 3)
  // Nonlinear clamp: undoing a penalty at the floor must not grant free trust.
  assert.equal(x.view({ baseline: { trust: 0, closeness: 0, tension: 0 } }).relationship.trust, 0.02)
})

test('uncertain clarification retains previous event; stale correction and foreign correction are rejected', async t => {
  const x = setup(t)
  const first = await x.run(x.input, answer(x.input, 'hurt', 'betrayal'))
  const i = { ...x.input, turn: { id: 'c', at: 1000100, text: '只是玩笑吧。' } }
  const a = answer(i, 'uncertain'); a.selected = null
  assert.equal((await x.run(i, a, { supersedes: first.eventId })).status, 'unresolved')
  assert.equal(x.view().relationship.trust, 0.46)
  a.selected = 0 // Even a contradictory high-confidence "uncertain" cannot erase harm.
  assert.equal((await x.run(i, a, { supersedes: first.eventId })).status, 'unresolved')
  const foreign = { ...i, scope: 'other' }
  await assert.rejects(x.run(foreign, answer(foreign), { supersedes: first.eventId }), /same scope/)
  await x.run(i, answer(i), { supersedes: first.eventId })
  const later = { ...i, turn: { ...i.turn, id: 'c2', at: 1000200 } }
  await assert.rejects(x.run(later, answer(later), { supersedes: first.eventId }), /active event/)
})

test('duplicate turn is idempotent; reused ID with different text and out-of-order input fail', async t => {
  const x = setup(t)
  await x.run()
  assert.equal((await x.run(x.input, null, { generate() { throw Error('must not call') } })).status, 'duplicate')
  await assert.rejects(x.run({ ...x.input, turn: { ...x.input.turn, text: 'different' } }), /reused/)
  await assert.rejects(x.run({ ...x.input, turn: { ...x.input.turn, id: 'old', at: 999999 } }), /Out-of-order/)
  assert.equal(x.view().events, 1)
})

test('concurrent stale model output does not overwrite the newer journal', async t => {
  const x = setup(t)
  let release
  const wait = new Promise(r => { release = r })
  let started
  const ready = new Promise(r => { started = r })
  const slow = x.run(x.input, null, { generate: async () => { started(); await wait; return answer(x.input) } })
  await ready
  const next = { ...x.input, turn: { ...x.input.turn, id: 'second', at: 1000100 } }
  await x.run(next)
  release()
  assert.equal((await slow).status, 'stale')
  assert.equal(x.view().events, 1)
})

test('provider error, skip, timeout and cancellation leave no event behind', async t => {
  const x = setup(t)
  assert.equal((await x.run(x.input, { skip: true })).status, 'skipped')
  await assert.rejects(x.run(x.input, null, { generate() { throw Error('provider down') } }), /provider down/)
  await assert.rejects(x.run(x.input, null, { generate: () => new Promise(() => {}), timeoutMs: 10 }), /aborted/)
  const c = new AbortController(); c.abort()
  await assert.rejects(x.run(x.input, null, { signal: c.signal, generate() { throw Error('must not call') } }))
  assert.equal(fs.existsSync(x.file), false)
})

test('journal persists across calls, isolates readers and fails closed on a corrupt line', async t => {
  const x = setup(t)
  await x.run(x.input, answer(x.input, 'support', 'care'))
  assert.equal(projectEmotion(x.dir, x.input, { now: 1000000 }).relationship.trust, 0.51)
  assert.equal(projectEmotion(x.dir, { ...x.input, personId: 'other' }, { now: 1000000 }).events, 0)
  fs.appendFileSync(x.file, '{broken\n')
  assert.throws(() => x.view())
  const next = { ...x.input, turn: { ...x.input.turn, id: 'new' } }
  await assert.rejects(x.run(next))
})

test('development corpus contains same-text contrasts; labels do not enter model input', () => {
  assert.equal(cases[0].input.turn.text, cases[1].input.turn.text)
  assert.equal(cases[6].input.turn.text, cases[7].input.turn.text)
  for (const item of cases) {
    const payload = JSON.parse(buildMessages(prepareContext(item.input))[1].content)
    assert.equal(payload.note, undefined)
    assert.equal(payload.kinds, undefined)
    assert.equal(payload.relationship, undefined)
  }
})

test('evaluation preserves failures in the denominator and never treats all-abstain as understanding', t => {
  const x = setup(t)
  const provider = path.join(x.dir, 'provider.mjs')
  fs.writeFileSync(provider, `export async function generate(messages) {
    const c = JSON.parse(messages[1].content);
    if ('kinds' in c || 'note' in c) throw Error('Leaked expectations');
    if (c.turn.text.includes('哭')) throw Error('Synthetic provider failure');
    return {interpretations:[],selected:null,selfFeelings:[],relationship:{kind:'none',target:'unclear',basis:[]}};
  }`)
  const output = path.join(x.dir, 'report.json')
  const script = fileURLToPath(new URL('../examples/text-emotion/evaluate.mjs', import.meta.url))
  execFileSync(process.execPath, [script, '--provider', provider, '--out', output])
  const report = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(report.results.length, 36)
  assert.equal(report.semanticAccuracy, null)
  assert.equal(report.structuralSummary.guided.attempted, 18)
  assert.ok(report.structuralSummary.guided.errorsOrSkipped >= 3)
  assert.ok(report.structuralSummary.guided.proposalChecksPassed < 10)
  assert.ok(report.results.every(r => Array.isArray(r.messages)))
})

test('medium observed boundary is an explicit exception, not a global threshold reduction', () => {
  const input = context('你真笨。', [], [['boundary', '我说过不要叫我笨。']])
  const sources = prepareContext(input).sources
  const a = answer(input, 'boundary', 'boundary_violation')
  a.interpretations[0].certainty = 'medium'
  a.relationship.basis.push(quote('memory:m0', input.memories[0].text))
  const validated = validateAppraisal(a, sources)
  assert.equal(settle(validated, { sources, policy: 'boundary-v2' }).relationshipKind, 'boundary_violation')
  assert.equal(settle(validated, { sources }).relationshipKind, 'none')
  assert.equal(settle(validated, { sources, policy: 'legacy-high' }).relationshipKind, 'none')
  assert.equal(settle(validated).relationshipKind, 'none')
  for (const [kind, certainty, target] of [['boundary', 'low', 'person'], ['playful', 'medium', 'person'], ['mixed', 'medium', 'person'], ['boundary', 'medium', 'other'], ['boundary', 'medium', 'unclear']]) {
    const v = structuredClone(validated); v.interpretations[0].kind = kind; v.interpretations[0].certainty = certainty; v.relationship.target = target
    assert.equal(settle(v, { sources, policy: 'boundary-v2' }).relationshipKind, 'none')
  }
  for (const kind of ['care', 'betrayal', 'repair', 'kept_promise']) {
    const v = answer(input, 'mixed', kind); v.interpretations[0].certainty = 'medium'
    assert.equal(settle(validateAppraisal(v, sources), { sources, policy: 'boundary-v2' }).relationshipKind, 'none')
  }
})

test('legacy journal keeps high-only settlement and obsolete hints do not reach new consumers', async t => {
  const x = setup(t)
  const input = context('你真笨。', [], [['boundary', '不要叫我笨。']])
  const a = answer(input, 'boundary', 'boundary_violation'); a.interpretations[0].certainty = 'medium'
  a.relationship.basis.push(quote('memory:m0', input.memories[0].text))
  a.responseHint = '我也很难过'
  const result = await x.run(input, a)
  assert.equal('responseHint' in result.appraisal, false)
  assert.doesNotMatch(fs.readFileSync(x.file, 'utf8'), /responseHint/)
  assert.doesNotMatch(JSON.stringify(buildMessages(prepareContext(input))), /responseHint/)
  assert.equal(x.view().relationship.trust, 0.48)
  const row = JSON.parse(fs.readFileSync(x.file, 'utf8')); delete row.settlementPolicy
  fs.writeFileSync(x.file, JSON.stringify(row) + '\n')
  assert.equal(x.view().relationship.trust, 0.5)
})

test('a blocked wrong proposal must not count as a correct proposal', () => {
  const input = context('游戏里互相打趣。')
  const a = answer(input, 'playful', 'care')
  const applied = settle(a)
  const checks = score({ kinds: ['playful'], relationship: 'none' }, a, applied)
  assert.equal(checks.proposed, false); assert.equal(checks.applied, true)
  const summary = summarize([{ checks, proposed: 'care', applied }])
  assert.equal(summary.proposalChecksPassed, 0); assert.equal(summary.appliedMatches, 1); assert.equal(summary.blockedProposals, 1)
  assert.equal(summary.blockedWrong, 1); assert.equal(summary.blockedCorrect, 0)
})

test('medium boundary clarification records the same effect as a new event, without double charging', async t => {
  const fresh = setup(t); const revised = setup(t)
  const first = await revised.run()
  const input = context('我说过不要叫我笨，你刚才又这样叫了。', [], [['boundary', '不要叫我笨。']])
  input.turn.id = 'clarification'; input.turn.at = 1000100
  const a = answer(input, 'boundary', 'boundary_violation')
  a.interpretations[0].certainty = 'medium'
  a.relationship.basis.push(quote('memory:m0', input.memories[0].text))
  const direct = await fresh.run(input, a)
  const correction = await revised.run(input, a, { supersedes: first.eventId })
  assert.equal(correction.status, 'recorded')
  assert.deepEqual(correction.applied, direct.applied)
  assert.equal(revised.view().relationship.trust, 0.48)
  assert.equal(revised.view({ now: 1000000 }).relationship.trust, 0.5)
  assert.equal((await revised.run(input, a, { supersedes: first.eventId })).status, 'duplicate')
  assert.equal(revised.view().relationship.trust, 0.48)
  const again = { ...input, turn: { ...input.turn, id: 'confirm', at: 1000200 } }
  await revised.run(again, a, { supersedes: correction.eventId })
  assert.equal(revised.view().relationship.trust, 0.48)
})

test('medium clarification cannot remove or soften harm; high clarification still can', async t => {
  const x = setup(t)
  const first = await x.run(x.input, answer(x.input, 'hurt', 'betrayal'))
  const input = context('只是开玩笑，我以后不叫你笨了。', [], [['boundary', '不要叫我笨。']])
  input.turn.id = 'clarify'; input.turn.at = 1000100
  const before = fs.readFileSync(x.file, 'utf8')
  for (const [kind, relation] of [['playful', 'none'], ['boundary', 'boundary_violation']]) {
    const a = answer(input, kind, relation); a.interpretations[0].certainty = 'medium'
    if (relation === 'boundary_violation') a.relationship.basis.push(quote('memory:m0', input.memories[0].text))
    assert.equal((await x.run(input, a, { supersedes: first.eventId })).status, 'unresolved')
    assert.equal(fs.readFileSync(x.file, 'utf8'), before)
    assert.equal(x.view().relationship.trust, 0.46)
  }
  assert.equal((await x.run(input, answer(input, 'playful'), { supersedes: first.eventId })).status, 'recorded')
  assert.equal(x.view().relationship.trust, 0.5)
})

test('blockedCorrect is distinct from blockedWrong under the frozen rubric', () => {
  const input = context('不要叫我笨。', [], [['boundary', '不要叫我笨。']])
  const a = answer(input, 'boundary', 'boundary_violation'); a.interpretations[0].certainty = 'medium'
  a.relationship.basis.push(quote('memory:m0', input.memories[0].text))
  const applied = settle(a) // Legacy default blocks this correct proposal.
  const checks = score({ kinds: ['boundary'], relationship: 'boundary_violation' }, a, applied)
  const s = summarize([{ checks, proposed: 'boundary_violation', applied }])
  assert.equal(s.blockedCorrect, 1); assert.equal(s.blockedWrong, 0)
  assert.equal(s.blockedProposals, s.blockedCorrect + s.blockedWrong)
})
