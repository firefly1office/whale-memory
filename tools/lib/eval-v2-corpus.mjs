// 把 eval/corpus-v2.json 摆成一个临时记忆目录（和 whale-eval 一样的做法），跑完就删。
// eval-v2 评测与 tests/eval-v2-corpus.test.mjs 共用这一份，免得两处对「语料怎么摆」各写一套。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as exp from '../../packages/core/lib/self-experience.js'
import * as unsaid from '../../packages/core/lib/unsaid.js'
import * as chapterEvents from '../../packages/core/lib/chapter-events.js'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

export function loadEvalV2(root = ROOT) {
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'eval/corpus-v2.json'), 'utf8'))
  const caseFile = JSON.parse(fs.readFileSync(path.join(root, 'eval/cases-v2.json'), 'utf8'))
  return { corpus, caseFile }
}

// 语料 → 经历行。字段形状与 whale-eval 写入的那一套一致（day 用本地日）
export function rowOf(e) {
  return {
    id: e.id,
    at: e.at,
    day: new Date(e.at).toLocaleDateString('sv-SE'),
    author: 'self',
    source: 'own-time',
    kind: e.kind || '其它',
    weight: e.weight || 'normal',
    later: [],
    status: 'kept',
    then: {
      text: e.text,
      scene: '',
      feeling: e.feeling || [],
      thought: e.thought || '',
      unfinished: e.unfinished || '',
      quote: e.quote || null,
      ...(e.refs ? { refs: e.refs } : {}),
      state: { at: e.at }
    }
  }
}

// 写经历 + 逐条执行操作。任何一步失败都抛：语料摆错了，后面的数字没有意义。
export function buildCorpus(dir, corpus) {
  const memoryDir = path.join(dir, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(memoryDir, { recursive: true })
  const file = path.join(memoryDir, 'self-experience.jsonl')
  fs.writeFileSync(file, corpus.experiences.map((e) => JSON.stringify(rowOf(e))).join('\n') + '\n', 'utf8')
  const applied = []
  for (const o of corpus.operations) {
    let r = { ok: true }
    if (o.op === 'revise') r = exp.reviseExperience(memoryDir, { id: o.id, thought: o.thought, feeling: (o.feeling || []).join(',') })
    else if (o.op === 'unfinished') r = exp.setUnfinishedState(memoryDir, { id: o.id, choice: o.state, note: o.note || '' })
    else if (o.op === 'seal') r = exp.setSealed(memoryDir, { id: o.id, sealed: true, note: o.note || '' })
    else if (o.op === 'link') r = exp.linkExperiences(memoryDir, { from: o.from, to: o.to, reason: o.reason })
    else if (o.op === 'chapter') chapterEvents.open(memoryDir, { name: o.name, from: o.from, to: o.to })
    else if (o.op === 'unsaid') r = unsaid.leaveUnsaid(memoryDir, { chatKey: 'local:owner', kind: o.kind, text: o.text })
    else throw new Error('不认识的语料操作：' + JSON.stringify(o))
    if (r && r.ok === false) throw new Error('语料操作失败：' + JSON.stringify(o) + ' → ' + r.error)
    applied.push(o.op)
  }
  return { dataDir: dir, memoryDir, file, applied: applied.length }
}