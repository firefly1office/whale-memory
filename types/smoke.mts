// 类型冒烟：CI 里用 tsc --strict 跑这个文件，保证 .d.ts 与导出对得上
import { selfExperience, evidencePolicy, evidenceFromExperience, selfPrompt, waking, unfinishedEvents } from '../packages/core/index.js'

const rows = selfExperience.loadAll('/tmp/whale')
const made = selfExperience.addExperience('/tmp/whale', { text: '灯塔', weight: 'important' })
selfExperience.reviseExperience('/tmp/whale', { id: made.id, thought: '在等船' })

const verdict = evidencePolicy.query([], { subject: 'self', slot: 'mood' })
const facts = evidenceFromExperience.factsFromExperiences(rows)
const answer = evidenceFromExperience.ask(rows, { slot: 'mood' })

const block = waking.buildWakingBlock('/tmp/whale', 'local:owner')
const prompt = selfPrompt.save('/tmp/whale', '短一点')
const ctx = selfExperience.recallForContext('/tmp/whale', '灯塔', { max: 1 })
const firstCtx = ctx[0]
if (firstCtx) console.log(firstCtx.text, firstCtx.raw.then.text)

const pending = selfExperience.pendingLegacyEvents('/tmp/whale')
const back = selfExperience.setUnfinishedState('/tmp/whale', { id: made.id, choice: 'shelved' })
const lastChoice = unfinishedEvents.latestByExp('/tmp/whale').get(made.id)?.choice
console.log(pending.length, made.matchedLater?.length, made.formerId, back.ok, lastChoice)
console.log(rows.length, made.then.text, verdict.status, facts.length, answer.status, block, prompt.ok)

// 0.12：翻回那天、后来的感觉、出处
const past = selfExperience.loadAll('/tmp/whale', { asOf: '2026-11-15' })
const pastOne = selfExperience.currentView('/tmp/whale', made.id, { asOf: new Date() })
const pastHits = selfExperience.recall('/tmp/whale', '灯塔', { asOf: '2026-11-15T12:00:00.000Z' })
const felt = selfExperience.reviseExperience('/tmp/whale', { id: made.id, thought: '释然了', feeling: ['释然'] })
const echo = selfExperience.addExperience('/tmp/whale', { text: '回想', refs: [made.id] })
const feelings = evidenceFromExperience.feelingFacts(rows)
console.log(past.length, pastOne?.viewAsOf, pastHits.length, felt.feeling?.join(), echo.then.refs?.length, echo.refsInfo?.[0]?.missing, echo.citedBy?.length, feelings.length)