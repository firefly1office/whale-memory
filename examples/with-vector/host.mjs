// 组合演示：向量库负责「找到可能相关的经历」，whale-memory 负责「她还是不是她」
// 跑法：node examples/with-vector/host.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from '../../packages/core/lib/self-experience.js'
import { createStore } from './vector-store.mjs'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-vector-'))

// 1) 角色自己写下两条经历
const lighthouse = exp.addExperience(dataDir, {
  text: '读到灯塔那个故事，守灯人整晚没睡',
  thought: '她是在等人回来吧',
  quote: { text: '守灯人整晚没睡，灯一直亮着', source: '《第一天的故事》' },
  weight: 'important'
})
exp.addExperience(dataDir, {
  text: '下午折了一次纸，折坏了',
  thought: '手笨'
})

// 2) 宿主侧：把经历灌进自己的向量库（这一步不属于 whale-memory）
const store = createStore()
for (const row of exp.loadAll(dataDir).filter((r) => !r.sealed)) {
  store.add(row.id, row.then.text + ' ' + row.then.thought)
}
console.log('[向量库] 已索引 ' + store.size() + ' 条')

// 3) 用户问了一句；宿主自己决定召回，不用 recall 命令
const question = '昨天那个守灯人的故事，她后来睡了吗'
const candidates = store.search(question, { topK: 2, minScore: 0.25 })
console.log('[向量库] 候选：' + candidates.map((c) => c.id + '(' + c.score.toFixed(2) + ')').join(', '))

// 4) whale-memory 只做结构：按 id 取回，渲染「当时 / 现在」
const byId = new Map(exp.loadAll(dataDir).filter((r) => !r.sealed).map((r) => [r.id, r]))
const picks = candidates.map((c) => byId.get(c.id)).filter(Boolean)
for (const row of picks) {
  console.log('\n【宿主递回来的经历】')
  console.log(exp.renderTwoPart(row))
}

// 5) 她改主意：结构保证原文不被覆盖
exp.reviseExperience(dataDir, {
  id: lighthouse.id,
  thought: '现在觉得她不是怕黑，是怕船回来时没人看见灯',
  reason: '又读了一遍'
})
console.log('\n[角色] 她改了主意，重新渲染同一条：')
console.log(exp.renderTwoPart(exp.currentView(dataDir, lighthouse.id)))

console.log('\n注意：召回由宿主负责；whale-memory 只负责 then 不被覆盖、later 追加。')
fs.rmSync(dataDir, { recursive: true, force: true })