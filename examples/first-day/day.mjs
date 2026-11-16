// 一天的戏：--day=1 读故事并留下一条；--day=2 宿主在她被问到相关话题时，把昨天递回来
// 关键：第二天没有任何人输入 recall 命令，触发是宿主自己的判断
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as exp from '../../packages/core/lib/self-experience.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : ''
}
const dataDir = arg('data')
const day = Number(arg('day') || 1)
const mem = path.join(dataDir, 'plugin-data', 'biomimetic-memory')

if (!dataDir) {
  console.error('需要 --data=<dir>')
  process.exit(1)
}

if (day === 1) {
  const story = fs.readFileSync(path.join(here, 'story.md'), 'utf8')
  const line = '守灯人整晚没睡，灯一直亮着'
  if (!story.includes('守灯人整晚没睡')) {
    console.error('故事里找不到要留的那句')
    process.exit(1)
  }
  const row = exp.addExperience(mem, {
    text: '读到灯塔那个故事，守灯人整晚没睡，灯一直亮着',
    scene: '晚上，读完故事',
    feeling: ['闷'],
    thought: '她是在等人回来吧',
    unfinished: '想知道第二天她下塔了没有',
    quote: { text: line, source: '《第一天的故事》' },
    weight: 'important'
  })
  console.log('[第 1 天] 她留下了一条经历：', row.id)
  console.log('  原文锚：' + line)
  process.exit(0)
}

// 第 2 天：宿主侧。用户只是随口问，没有调用任何检索命令
const userLine = '昨天那本灯塔的故事，守灯人后来睡了吗？'
console.log('[第 2 天] 用户说：' + userLine)

// 宿主自己决定：这句话提到了「灯塔」相关的话题，试着把昨天递回来
const hits = exp.recall(mem, userLine, { limit: 2, mode: 'loose' })
if (!hits.length) {
  console.log('[宿主] 没有相关记录，今天不递。')
  process.exit(0)
}

const yesterday = hits[0]
console.log('[宿主] 判断相关，把昨天递回来（没有让用户输入 recall）：')
console.log('【递回来的昨天】')
console.log(exp.renderTwoPart(yesterday))

// 角色可以略过，也可以改主意。这里演示改主意：只追加，不改原文
exp.reviseExperience(mem, {
  id: yesterday.id,
  thought: '现在觉得她不是怕黑，是怕那条船回来的时候没人看见灯',
  reason: '第二天又读了一遍'
})
console.log('[第 2 天] 她改了主意；原文没有被覆盖：')
const view = exp.currentView(mem, yesterday.id)
console.log('  当时：' + view.then.thought)
console.log('  现在：' + (view.later.at(-1) ? view.later.at(-1).thought : ''))