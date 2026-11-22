// 从 npm 安装已发布的 core，按接入指南原样跑：写入 → 修订 → 两个视图。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('npm 上的 whale-memory-core@0.21.0 能按指南跑通', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-npm-'))
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'consumer', private: true }), 'utf8')
    const installed = spawnSync('npm', ['install', 'whale-memory-core@0.21.0', '--no-audit', '--no-fund'], { cwd: tmp, encoding: 'utf8', shell: true })
    assert.equal(installed.status, 0, installed.stderr)
    const script = `
import { selfExperience } from 'whale-memory-core'
const dir = './data'
const { id, at } = selfExperience.addExperience(dir, { text: '读到守灯人怕黑', thought: '我以为他怕黑' })
await new Promise((r) => setTimeout(r, 5))
selfExperience.reviseExperience(dir, { id, thought: '他在给晚归的船留灯' })
const before = selfExperience.currentView(dir, id, { asOf: at })
const after = selfExperience.currentView(dir, id, {})
console.log(JSON.stringify({ before: before.later.length, after: after.later.length, thought: after.later[0]?.thought }))
`
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: tmp, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout.trim())
    assert.equal(out.before, 0)
    assert.equal(out.after, 1)
    assert.equal(out.thought, '他在给晚归的船留灯')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('README 空值说明：证据与 write 独立', async () => {
  const { scoreTurn } = await import('../packages/emotion-intake/index.js')
  const r = scoreTurn({ otherText: '', selfText: '房间有点闷' })
  assert.equal(r.write, null)
  assert.ok(r.selfEvidence.includes('闷'))
})