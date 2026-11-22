// 十行示例：一句话进来，候选出去；写不写由宿主决定。
import { scoreTurn, recordWrite } from './index.js'

const r = scoreTurn({ otherText: '我有点累', selfText: '我也有点闷' })

console.log('证据（她）:', r.selfEvidence)   // ['闷']
console.log('候选（需宿主决定是否写）:', r.write) // { dim:'v', value:-0.15, source:'self_felt', ... }
console.log('时刻候选（需宿主决定是否记）:', r.moment) // true

if (r.write) {
  const next = recordWrite({ intakeLog: [] }, { now: Date.now(), write: r.write })
  console.log('写入后日志条数:', next.intakeLog.length) // 1
}

// 给自动化测试看的机器可读结果
console.log(JSON.stringify({ self: r.selfEvidence, write: r.write, moment: r.moment }))