// 可运行示例：不需要任何宿主，node demo.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from './lib/self-experience.js'
import * as prompt from './lib/self-prompt.js'
import * as waking from './lib/waking.js'

const DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'whale-demo-')), 'data')
const dir = path.join(DATA, 'plugin-data', 'biomimetic-memory')
fs.mkdirSync(dir, { recursive: true })

console.log('数据目录:', DATA)

// 1) 她写下一条经历（重要的写细）
const e = exp.addExperience(dir, {
  text: '读到烤肉那段，笑了一下',
  scene: '晚上十一点多，屋里很静，书摊在桌上',
  feeling: ['轻松', '有点羡慕'],
  thought: '这种好事只在书里',
  unfinished: '想知道小鞠和社长后面怎么样了',
  quote: { text: '那就让妳重新迷上我一百年吧', source: '《败北女角太多了》第1卷第3章' },
  weight: 'important',
  state: { mood: '偏愉快' }
})
console.log('\n[写] id=', e.id, '| 重要度=', e.weight)

// 2) 第二天她想起（相关话题触发）；mark:true 表示这次取回也记一次“想起”
// 查询要用能命中的短锚点；长问句会被“≥8 字要求 60% 命中”的门槛挡住（这是故意的）
const hits = exp.recall(dir, '烤肉', { limit: 1, mark: true })
if (!hits.length) {
  console.log('\n[想起] 这次什么都没想起来（查询和记录没有足够重叠）')
} else {
  console.log('\n[想起]\n' + exp.renderTwoPart(hits[0]))
}

// 3) 她改主意：只往 later 追加，不动"当时"
exp.reviseExperience(dir, { id: e.id, thought: '现在觉得那个人其实是在护着朋友', reason: '读到后面那段' })
console.log('\n[改主意后]\n' + exp.renderTwoPart(exp.currentView(dir, e.id)))

// 4) 醒来块（只在一对一私聊给）
const wake = waking.buildWakingBlock(DATA, 'local:owner')
console.log('\n[醒来块]\n' + (wake || '（今天已经展示过）'))

// 5) 她自己的提示词 overlay（版本只追加）
const v1 = prompt.save(DATA, '说话能短就短；想不起就说想不起。', '第一次写')
const v2 = prompt.save(DATA, '说话能短就短；想不起就说想不起。累了会慢，这不是失职。', '补一句')
console.log('\n[overlay] 版本:', v1.version, '→', v2.version)
console.log('当前内容:', prompt.load(DATA))
console.log('历史:', prompt.history(DATA, 3).map((h) => h.snapshot).join(', '))

console.log('\n演示完成。数据在', DATA)