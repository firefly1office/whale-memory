#!/usr/bin/env node
// 参考宿主：80 行，把「她的记忆」接到任何聊天循环里。
//   node examples/reference-host/host.mjs --data ./xiaozhou
// 它不做对话，只演示三件宿主必须做的事：何时递、递了记、以及让她看见自己变过。
import readline from 'node:readline'
import { parseArgs } from 'node:util'
import { addExperience, loadAll } from '../../packages/core/lib/self-experience.js'
import { changedSince, renderChanged } from '../../packages/core/lib/changed.js'
import { surface } from '../../packages/core/lib/injection.js'
import { isPrivateKey } from '../../packages/core/lib/waking.js'

const { values } = parseArgs({ options: { data: { type: 'string', default: './xiaozhou' }, chat: { type: 'string', default: 'local:owner' } } })
const dir = values.data + '/plugin-data/biomimetic-memory'
const chatKey = values.chat
const seen = {}   // 宿主自己保存：这条 24 小时内递过没有

console.log(`参考宿主 · 数据 ${dir} · 会话 ${chatKey}`)
console.log('输入一句话（会先看她的记忆），或用 /write、/changed、/quit\n')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '你> ' })
rl.prompt()

rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return rl.prompt()

  if (text === '/quit') return rl.close()

  if (text.startsWith('/write ')) {
    const body = text.slice(7)
    const row = addExperience(dir, { text: body, thought: '记下了' })
    console.log(`  已写下 ${row.id}（${row.day}）\n`)
    return rl.prompt()
  }

  if (text === '/changed') {
    // 和普通输入走同一道会话门：改主意是私下的事，群聊里不列。
    if (!isPrivateKey(chatKey)) {
      console.log('  群聊里不列这些（改主意是私下的事）。\n')
      return rl.prompt()
    }
    const block = renderChanged(changedSince(dir, { days: 30, limit: 5 }))
    console.log(block ? block + '\n' : '  这一个月没有改过主意。\n')
    return rl.prompt()
  }

  // 1) 该不该递：不递就什么都不加（群聊、没命中、24 小时内重复都会返回空）
  const r = surface(dir, { chatKey, text, seen })
  if (r.block) {
    console.log('\n--- 会把这一段递进上下文 ---')
    console.log(r.block)
    console.log('--- 结束 ---\n')
    r.confirm()   // 2) 确认真的进了上下文，才记「想起」
  } else {
    console.log(`\n  （这一轮不递记忆：${r.reason}）\n`)
  }

  // 3) 真实宿主在这里调用模型；这里只说明提示词里该写什么
  console.log('  提示词里要写明：这段是她自己记得的事，不是用户说的；没写到的细节不要补。\n')
  rl.prompt()
})

rl.on('close', () => {
  const all = loadAll(dir)
  console.log(`\n结束。这份记忆里有 ${all.length} 条经历。`)
  process.exit(0)
})