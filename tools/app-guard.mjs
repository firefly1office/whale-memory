// 应用存活守护：进程不在且无锁时自动拉起 0.5.1（每小时最多一次，避免抢启动）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const EXE = 'C:\\Users\\USER\\AppData\\Local\\Programs\\QQ Agent\\QQ Agent.exe'
const DIR = 'C:\\Users\\USER\\AppData\\Local\\Programs\\QQ Agent'
const DATA = 'C:\\Users\\USER\\QQAgentData'
const LOG = './开发/卡死排查-20261112/应用守护.log'
const STATE = './开发/卡死排查-20261112/应用守护状态.json'
const COOLDOWN = 30 * 60 * 1000

const stamp = () => new Date().toISOString()
const log = (s) => { fs.appendFileSync(LOG, `${stamp()} ${s}\n`, 'utf8'); console.log(s) }
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} } }
const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 1), 'utf8')

function running() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', "@(Get-Process -Name 'QQ Agent' -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', timeout: 15000 }).trim()
    return Number(out) > 0
  } catch { return false }
}

const st = readState()
if (running()) { save({ ...st, lastSeen: new Date().toISOString() }); console.log('运行中'); process.exit(0) }

const lockFile = path.join(DATA, 'qq-agent.lock')
if (fs.existsSync(lockFile)) {
  let pid = 0
  try { pid = Number(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid) || 0 } catch {}
  if (pid && (() => { try { execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Out-Null`], { timeout: 8000 }); return true } catch { return false } })()) {
    log(`锁指向活进程 ${pid}，跳过`)
    process.exit(0)
  }
  try { fs.unlinkSync(lockFile); log('清理陈旧锁') } catch {}
}

if (st.lastRestartAt && Date.now() - Number(st.lastRestartAt) < COOLDOWN) { log('冷却中，跳过'); process.exit(0) }

log('进程不在，拉起 0.5.1')
const env = { ...process.env, QQ_AGENT_DATA_DIR: DATA }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(EXE, [], { cwd: DIR, detached: true, stdio: 'ignore', windowsHide: false, env })
child.unref()
save({ ...st, lastRestartAt: Date.now() })
log('已拉起')