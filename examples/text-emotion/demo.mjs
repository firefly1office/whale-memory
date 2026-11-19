import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluateEmotion, projectEmotion } from '../../packages/emotion/index.js'
import { context } from './cases.mjs'

console.log('离线机制演示：候选判断预先写好，没有调用模型，不代表情感理解已通过评测。')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-emotion-demo-'))
function decision(input, kind, relation) {
  const basis = [{ source: 'current', quote: input.turn.text }]
  return { interpretations: [{ kind, certainty: 'high', meaning: '演示候选判断', emotions: [], basis }], selected: 0,
    selfFeelings: [], relationship: { kind: relation, target: 'person', basis: relation === 'none' ? [] : basis } }
}
try {
  const input = context('你可真笨啊。')
  const initial = await evaluateEmotion({ enabled: true, dir, input, generate: () => decision(input, 'hurt', 'betrayal') })
  console.log('模拟误判后的关系：', projectEmotion(dir, input, { now: 1000000 }).relationship)
  const clarification = { ...input, turn: { id: 'clarification', text: '刚才我是在读小说台词，不是在说你。', at: 1001000 } }
  await evaluateEmotion({ enabled: true, dir, input: clarification, supersedes: initial.eventId, generate: () => decision(clarification, 'quotation', 'none') })
  console.log('澄清后重新计算：', projectEmotion(dir, input, { now: 1001000 }).relationship)
  console.log('翻回澄清前仍看见旧判断：', projectEmotion(dir, input, { now: 1000000 }).relationship)
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
