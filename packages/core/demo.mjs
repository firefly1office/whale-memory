// 可运行示例：不需要任何宿主，node demo.mjs
// Runnable example, no host needed: node demo.mjs   (--lang en | zh; default follows WHALE_LANG, then your system locale)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from './lib/self-experience.js'
import * as prompt from './lib/self-prompt.js'
import * as waking from './lib/waking.js'

const argLang = (process.argv.find((a) => a.startsWith('--lang=')) || '').slice(7) || (process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : '')
const sysLocale = String(process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '')
const lang = (argLang || process.env.WHALE_LANG || (/^zh/i.test(sysLocale) ? 'zh' : 'en')) === 'zh' ? 'zh' : 'en'

// 示例内容：中文角色用中文，英文用户看英文（内容是虚构的）
const S = lang === 'zh' ? {
  dataDir: '数据目录:', wrote: '[写] id=', weight: '| 重要度=', recalled: '[想起]', none: '[想起] 这次什么都没想起来（查询和记录没有足够重叠）',
  revised: '[改主意后]', waking: '[醒来块]', shown: '（今天已经展示过）', overlay: '[overlay] 版本:', current: '当前内容:', history: '历史:', done: '演示完成。数据在',
  entry: { text: '读到烤肉那段，笑了一下', scene: '晚上十一点多，屋里很静，书摊在桌上', feeling: ['轻松', '有点羡慕'], thought: '这种好事只在书里', unfinished: '想知道小鞠和社长后面怎么样了', quote: { text: '那就让妳重新迷上我一百年吧', source: '《败北女角太多了》第1卷第3章' }, state: { mood: '偏愉快' } },
  query: '烤肉', revise: { thought: '现在觉得那个人其实是在护着朋友', reason: '读到后面那段' },
  p1: ['说话能短就短；想不起就说想不起。', '第一次写'], p2: ['说话能短就短；想不起就说想不起。累了会慢，这不是失职。', '补一句']
} : {
  dataDir: 'Data directory:', wrote: '[write] id=', weight: '| weight=', recalled: '[recall]', none: '[recall] Nothing came back this time (the query and the record do not overlap enough)',
  revised: '[after changing her mind]', waking: '[waking block]', shown: '(already shown today)', overlay: '[overlay] versions:', current: 'Current text:', history: 'History:', done: 'Demo finished. The data is in',
  entry: { text: 'Read the barbecue scene and laughed a little', scene: 'A bit after eleven at night, the room very quiet, the book open on the desk', feeling: ['relaxed', 'a little envious'], thought: 'Good things like that only happen in books', unfinished: 'Want to know what happens to the two of them later', quote: { text: 'Then let me make you fall for me again, for a hundred years', source: 'the novel she was reading, vol. 1 ch. 3' }, state: { mood: 'cheerful' } },
  query: 'barbecue scene', revise: { thought: 'Now I think he was actually protecting his friend', reason: 'read the later chapter' },
  p1: ['Keep it short. If you cannot remember, say so.', 'first version'], p2: ['Keep it short. If you cannot remember, say so. Being slow when tired is not a failure.', 'one more line']
}

const DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'whale-demo-')), 'data')
const dir = path.join(DATA, 'plugin-data', 'biomimetic-memory')
fs.mkdirSync(dir, { recursive: true })

console.log(S.dataDir, DATA)

// 1) 她写下一条经历（重要的写细） / She writes down an experience (important ones in detail)
const e = exp.addExperience(dir, { ...S.entry, weight: 'important' })
console.log('\n' + S.wrote, e.id, S.weight, e.weight)

// 2) 第二天她想起；mark:true 表示这次取回也记一次"想起" / The next day she recalls it; mark:true records the recall
// 查询要和记录有足够重叠；对不上就返回空——没有记录就说没有 / An empty result means "no record", never a guess
const hits = exp.recall(dir, S.query, { limit: 1, mark: true })
if (!hits.length) {
  console.log('\n' + S.none)
} else {
  console.log('\n' + S.recalled + '\n' + exp.renderTwoPart(hits[0], { lang }))
}

// 3) 她改主意：只往 later 追加，不动"当时" / She changes her mind: appended to "later", "then" is untouched
exp.reviseExperience(dir, { id: e.id, ...S.revise })
console.log('\n' + S.revised + '\n' + exp.renderTwoPart(exp.currentView(dir, e.id), { lang }))

// 4) 醒来块（只在一对一私聊给） / The waking block (only in one-to-one chats)
const wake = waking.buildWakingBlock(DATA, 'local:owner', { lang })
console.log('\n' + S.waking + '\n' + (wake || S.shown))

// 5) 她自己的提示词 overlay（版本只追加） / Her own prompt overlay (versions are append-only)
const v1 = prompt.save(DATA, ...S.p1)
const v2 = prompt.save(DATA, ...S.p2)
console.log('\n' + S.overlay, v1.version, '→', v2.version)
console.log(S.current, prompt.load(DATA))
console.log(S.history, prompt.history(DATA, 3).map((h) => h.snapshot).join(', '))

console.log('\n' + S.done, DATA)
