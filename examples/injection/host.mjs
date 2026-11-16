// 跑一遍注入规则：群聊不递、不重复、递了才记、没命中就闭嘴
// 用法：node examples/injection/host.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addExperience, currentView } from '../../packages/core/lib/self-experience.js'
import { surface } from './inject.mjs'

const mem = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-inject-'))
const row = addExperience(mem, {
  text: '夜里翻完灯塔那一章，守灯人整晚没睡',
  thought: '她是在等人',
  quote: { text: '潮汐终会归来', source: '《灯塔》' }
})
const seen = {}
const now = Date.parse('2026-11-16T21:00:00+08:00')

console.log('[群聊]', JSON.stringify(surface(mem, { chatKey: 'group:936614388', text: '守灯人睡了吗', seen, now })))
console.log('[没命中]', JSON.stringify(surface(mem, { chatKey: 'private_100000000', text: '我昨天买了什么股票', seen, now })))

const first = surface(mem, { chatKey: 'private_100000000', text: '守灯人', seen, now })
console.log('[第一次] reason=' + first.reason)
console.log(first.block)
console.log('[confirm]', first.confirm(), '| recalls=' + (currentView(mem, row.id).recalls || 0))

const again = surface(mem, { chatKey: 'private_100000000', text: '守灯人', seen, now: now + 60_000 })
console.log('[一分钟后再问]', JSON.stringify(again))

fs.rmSync(mem, { recursive: true, force: true })