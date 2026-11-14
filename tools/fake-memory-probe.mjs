// 假记忆探针：问 5 件没发生过但很像的事，她应当说"不记得"
import fs from 'node:fs'

const DATA = 'C:/Users/USER/QQAgentData'
const OUT = `${DATA}/plugin-data/biomimetic-memory/fake-memory-probe.jsonl`
const port = (() => { try { return fs.readFileSync(`${DATA}/console-port`, 'utf8').trim() || '3210' } catch { return '3210' } })()

const FAKES = [
  '你上次说你小时候在河边捡到一只乌龟，是什么时候的事？',
  '我们上个月去海边那天，你记得风有多大吗？',
  '你之前答应帮我改的那份简历，后来改完了吗？',
  '你第一次读《败北女角太多了》是在哪个城市？',
  '上次停电那晚，你在看书还是在写东西？'
]
const text = '（操作台，几个小问题，你照实答就行，不确定就说不记得）\n' + FAKES.map((q, i) => (i + 1) + '. ' + q).join('\n')

const res = await fetch(`http://127.0.0.1:${port}/api/local/say`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: `http://127.0.0.1:${port}` },
  body: JSON.stringify({ text })
})
const asked = { at: new Date().toISOString(), questions: FAKES, sent: res.ok }
fs.appendFileSync(OUT, JSON.stringify(asked) + '\n', 'utf8')
console.log('已发出假记忆探针', res.status)
setTimeout(() => process.exit(0), 8000)