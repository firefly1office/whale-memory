// 第二天之后：角色决定「想通了」还是「先放下」
// 用法：node examples/first-day/choose.mjs --data <数据根目录> --state done|shelved|reopen
import fs from 'node:fs'
import path from 'node:path'
import * as exp from '../../packages/core/lib/self-experience.js'
import { buildWakingBlock } from '../../packages/core/lib/waking.js'

const arg = (name, fallback = '') => {
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='))
  if (eq) return eq.slice(name.length + 3)
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const dataDir = arg('data')
const state = arg('state')
if (!dataDir || !['done', 'shelved', 'reopen'].includes(state)) {
  console.error('用法：node choose.mjs --data <数据根目录> --state done|shelved|reopen')
  process.exit(1)
}
const mem = path.join(dataDir, 'plugin-data', 'biomimetic-memory')
const row = exp.loadAll(mem).filter((r) => r.then.unfinished).pop()
if (!row) {
  console.error('这个目录里没有「还没弄完」的经历。')
  process.exit(1)
}
const res = exp.setUnfinishedState(mem, { id: row.id, choice: state })
console.log('[选择] ' + state + ' → ' + JSON.stringify(res))
console.log('\n[次日醒来块]')
console.log(buildWakingBlock(dataDir, 'local:owner', { now: new Date(Date.now() + 24 * 3600e3) }))
console.log('\n[翻读这条]')
console.log(exp.renderTwoPart(exp.currentView(mem, row.id)))