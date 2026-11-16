// 类型冒烟：CI 里用 tsc --strict 跑这个文件，保证 .d.ts 与导出对得上
import { selfExperience, evidencePolicy, evidenceFromExperience, selfPrompt, waking, unfinishedEvents, sealEvents, recap, linkEvents, chapterEvents, book } from '../packages/core/index.js'

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
// 0.13：封存、回顾
const sealedRes = selfExperience.setSealed('/tmp/whale', { id: made.id, sealed: true, note: '不想再被提起' })
const stillSealed = sealEvents.sealedByExp('/tmp/whale').get(made.id)?.day
const withSealed = selfExperience.recall('/tmp/whale', '灯塔', { includeSealed: true })
const rc = recap.recap('/tmp/whale', { days: 7 })
const rcText: string = recap.renderRecap(rc)
console.log(sealedRes.noop, stillSealed, withSealed[0]?.sealed?.note, rc.feelingShifts[0]?.now.join(), rc.settled[0]?.choice, rcText.length)

// 0.14：事后联想、人生章节、她的书
const linked = selfExperience.linkExperiences('/tmp/whale', { from: made.id, to: echo.id, reason: '都是在等' })
const linkCount = linkEvents.linksByExp('/tmp/whale').get(made.id)?.length
const opened = chapterEvents.open('/tmp/whale', { name: '灯塔书店的秋天', from: '2026-11-01' })
const chs = chapterEvents.chapters('/tmp/whale')
const inChapter = chapterEvents.chaptersOn(chs, '2026-11-16')[0]?.names.join()
const md: string = book.renderBook('/tmp/whale', { asOf: '2026-11-16', includeSealed: false })
console.log(linked.noop, linkCount, opened.row?.id, inChapter, rows[0]?.links?.[0]?.reason, rows[0]?.chapters?.[0]?.name, md.length)
