// 她自己的时间：每天固定时段发一条“没有人在等你”的提示；做什么由她定，记不记由她定
import fs from 'node:fs'

const DATA = 'C:/Users/USER/QQAgentData'
const port = (() => { try { return fs.readFileSync(`${DATA}/console-port`, 'utf8').trim() || '3210' } catch { return '3210' } })()

const prompts = [
  '（你定的时间到了。没人在等你回话，做什么都行。要是想起以前的一件事，可以自己翻翻；不想翻就发呆。要留就自己记，不记也没关系。想给明天的自己留一句，就用 self_leave_note。）',
  '（你自己的这段时间到了。不催你，也不用回谁。想做什么就做什么，不想做就空着。）'
]
const text = prompts[Math.floor(Math.random() * prompts.length)]

const res = await fetch(`http://127.0.0.1:${port}/api/local/say`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: `http://127.0.0.1:${port}` },
  body: JSON.stringify({ text })
})
console.log('已发送自己的时间提示:', res.status)