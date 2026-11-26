// 类型冒烟：CI 里用 tsc --strict 跑这个文件，保证 .d.ts 与导出对得上
import { selfExperience, evidencePolicy, evidenceFromExperience, selfPrompt, waking, unfinishedEvents, sealEvents, recap, linkEvents, chapterEvents, book, unsaid, archive, hybridRecall } from '../packages/core/index.js'

import { recallDetail, timeSense, relativeWindow, personCard } from '../packages/core/index.js'
// 包入口上其余的模块：每个都要 import 一次，缺任何一个导出都会让这条冒烟测编译失败
import { scopeKey, conversationPrivacy, factCard, factStore, factJudge, changed, injection } from '../packages/core/index.js'
// file-lock 只在子路径导出（包入口没有），单独按相对路径验声明
import { writeFileAtomic } from '../packages/core/lib/file-lock.js'
const detail = recallDetail('/tmp/whale', '围巾是什么颜色')
const excerpt: string | undefined = detail.candidates[0]?.evidence[0]?.text
console.log(detail.status, excerpt)
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

// 0.15：没说出口的抽屉、打包与恢复
const drawerLeft = unsaid.leaveUnsaid('/tmp/whale', { chatKey: 'local:owner', kind: 'draft', text: '其实有点难过', reason: '不想让他担心' })
const drawer = unsaid.listUnsaid('/tmp/whale', { chatKey: 'local:owner', all: true })
const firstDrawer = drawer.ok ? drawer.items[0]?.kind : drawer.error
const spokenRes = drawerLeft.ok ? unsaid.markUnsaidSpoken('/tmp/whale', { chatKey: 'local:owner', id: drawerLeft.id }) : drawerLeft
const pack = archive.exportArchive('/tmp/whale', '/tmp/out')
const mf = archive.verifyArchive(pack.dir)
console.log(firstDrawer, spokenRes.ok, unsaid.badLines('/tmp/whale'), mf.files.length, archive.inside('/a/b', '/a'))

const when: string = timeSense.humanTime(Date.now())
const from: number | undefined = relativeWindow.parseRelativeWindow('上周三')?.from
const card: string = personCard.renderPersonCard({ 名字: '灯塔店员' })
console.log(when, from, card)

// 0.21.1：封存日志 strict 选项（坏行时由调用方决定 fail closed）
const strictSealed = sealEvents.sealedByExp('/tmp/whale', { strict: true }).get(made.id)?.day
const strictAsOf = sealEvents.sealedByExp('/tmp/whale', { until: Date.now(), strict: false }).size
console.log(strictSealed, strictAsOf)

// 0.21.2：包入口漏掉的 7 个导出，逐个 import + 最小调用（之前 .d.ts 少了它们，这条冒烟测也没 import，抓不到）
const scopeKeys: string[] = scopeKey.scopeKeysFor('local:owner#p_default')
const inScope: boolean = scopeKey.recordInScope('local:owner', 'local:owner#p_default')
const scoped: boolean = scopeKey.isPersonaScoped('local:owner#p_default')
const groupScope: boolean = scopeKey.isGroupScope('group_1')
const privateScope: boolean = scopeKey.isPrivateScope('local:owner')
const room = conversationPrivacy.roomOf('local:owner')
const audience = conversationPrivacy.createAudience({ ownerId: 'owner' })
const permits: boolean = audience.permits('local:owner', 'local:owner')
const masked: string = conversationPrivacy.redactSensitive('邮箱 owner@example.com')
const extracted = factCard.extractFacts('我养了一只猫叫小满')
const mergedFacts = factCard.mergeFacts(extracted)
const factLine: string = factCard.renderFact({ kind: 'like', value: '猫' })
const storedFacts = factStore.loadFacts('/tmp/whale')
const savedFacts = factStore.saveFacts('/tmp/whale', [{ kind: 'like', value: '猫' }])
const relevantFacts = factStore.relevantFacts(storedFacts, '猫')
const factsLine: string = factStore.renderFactsLine(relevantFacts)
const factKinds: string[] = factJudge.FACT_KINDS
const judged = factJudge.judgeFacts({ messages: [{ ref: 'm1', text: '我住在海边' }], chatCompletion: () => '' })
const changedItems = changed.changedSince('/tmp/whale', { days: 7 })
const changedText: string = changed.renderChanged(changedItems, { lang: 'zh' })
const surface = injection.surface('/tmp/whale', { chatKey: 'local:owner', text: '围巾' })
const inject = injection.shouldInject({ chatKey: 'local:owner', text: '围巾' })
console.log(scopeKeys.length, inScope, scoped, groupScope, privateScope, room?.key, permits, masked.length, mergedFacts.length, factLine, savedFacts.added, factsLine, factKinds.length, judged, changedText, surface.block, inject.ok, injection.INJECTION_RULES.length)

// 0.21.3：逐模块 d.ts 补齐的导出（运行时早就导出，类型声明里以前漏了）
const recovery = archive.recoverImport('/tmp/whale')
const journalPath: string = archive.importJournalPath('/tmp/whale')
const brokenLines: number = selfExperience.badLines('/tmp/whale')
const closed = unfinishedEvents.decide('/tmp/whale', { id: made.id, choice: 'shelved' })
const atomicPath: string = writeFileAtomic('/tmp/whale/atomic.txt', 'ok')
console.log(recovery.action, recovery.recovered, journalPath.length, brokenLines, closed.noop, closed.row?.choice, atomicPath.length)

// 作品稿本：类型声明要跟着实现走，加进来防止静默漂移
import { saveDraft, readDraft, listHistory } from '../packages/drafts/index.js'
const draftSaved = saveDraft('/tmp/drafts', { scopeKey: 'k', itemId: 'i', baseRevision: 0, text: 'x' })
if (draftSaved.ok) { const r = readDraft('/tmp/drafts', { scopeKey: 'k', itemId: 'i' }); void r; const h = listHistory('/tmp/drafts', { scopeKey: 'k', itemId: 'i' }); void h }

// 自主行动日志：接口小，但类型要跟着走
import { createSelfActionLog } from '../packages/core/lib/self-actions.js'
const actionLog = createSelfActionLog({ dir: '/tmp/actions', actions: ['draft_save'] })
const rec = actionLog.record({ action: 'draft_save', source: 'self', outcome: 'ok' })
if (rec.ok) { const s2 = actionLog.summarize({ days: 7 }); void s2 }

// 阶段 2：混合检索（实验性，默认仍走 literal）
const hybridHits = selfExperience.recall('/tmp/whale', '外婆家的树', { ranker: 'hybrid', context: ['读到一棵树'] })
const hybridVariants: string[] = hybridRecall.variantsOf('买花')
const hybridTokens: string[] = hybridRecall.tokensOf('外婆家的桂花树')
const hybridIndex = hybridRecall.buildIndex(['外婆家的桂花树'])
const hybridBm: number[] = hybridRecall.bm25Scores(hybridIndex, hybridTokens)
const hybridMinCover: number = hybridRecall.HYBRID_MIN_COVER
console.log(hybridHits.length, hybridVariants.length, hybridBm.length, hybridMinCover)
