// 类型冒烟：CI 里用 tsc --strict 跑这个文件，保证 .d.ts 与导出对得上
import { selfExperience, evidencePolicy, evidenceFromExperience, selfPrompt, waking } from '../packages/core/index.js'

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

console.log(rows.length, made.then.text, verdict.status, facts.length, answer.status, block, prompt.ok)