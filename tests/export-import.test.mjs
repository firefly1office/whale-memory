import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-export-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function cli(cliPath, args) {
  const res = spawnSync(process.execPath, [path.join(root, cliPath), ...args], { cwd: root, encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(res.stdout) } catch { }
  return { status: res.status, json, stdout: res.stdout, stderr: res.stderr }
}

for (const cliPath of CLIS) {
  test('导出 → 导入 → 读回（' + cliPath + '）', (t) => {
    const base = tmp(t)
    const data = path.join(base, 'data')
    const out = path.join(base, 'out')
    const data2 = path.join(base, 'data2')
    fs.mkdirSync(data, { recursive: true })
    fs.mkdirSync(out, { recursive: true })

    assert.equal(cli(cliPath, ['write', '--data', data, '--text', '灯塔那一章', '--thought', '她在等人', '--quote', '潮汐终会归来']).status, 0)
    const id = cli(cliPath, ['read', '--data', data, '--limit', '1']).json.items[0].id
    assert.equal(cli(cliPath, ['revise', '--data', data, '--id', id, '--thought', '现在觉得她在等船']).status, 0)

    const e = cli(cliPath, ['export', '--data', data, '--out', out])
    assert.equal(e.status, 0, e.stdout + e.stderr)
    assert.equal(e.json.ok, true)
    assert.equal(e.json.counts.experiences, 1)
    assert.equal(e.json.counts.laterEvents, 1)
    assert.ok(fs.existsSync(path.join(e.json.dir, 'manifest.json')))
    assert.equal(e.json.files, 2)

    const i = cli(cliPath, ['import', '--data', data2, '--from', e.json.dir])
    assert.equal(i.status, 0, i.stdout + i.stderr)
    assert.equal(i.json.ok, true)

    const back = cli(cliPath, ['read', '--data', data2, '--limit', '3']).json
    assert.equal(back.items.length, 1)
    assert.equal(back.items[0].id, id)
    assert.deepEqual(back.items[0].later, ['现在觉得她在等船'])
  })

  test('导入不覆盖已有数据，--force 才覆盖并留备份（' + cliPath + '）', (t) => {
    const base = tmp(t)
    const data = path.join(base, 'data')
    const out = path.join(base, 'out')
    fs.mkdirSync(data, { recursive: true })
    fs.mkdirSync(out, { recursive: true })
    assert.equal(cli(cliPath, ['write', '--data', data, '--text', '第一条']).status, 0)
    const e = cli(cliPath, ['export', '--data', data, '--out', out]).json

    const again = cli(cliPath, ['import', '--data', data, '--from', e.dir])
    assert.notEqual(again.status, 0)
    assert.match(again.json.error, /目标已有数据/)

    const forced = cli(cliPath, ['import', '--data', data, '--from', e.dir, '--force', 'true'])
    assert.equal(forced.status, 0, forced.stdout + forced.stderr)
    assert.ok(forced.json.backup && fs.existsSync(forced.json.backup), '覆盖前应留备份')
    assert.equal(cli(cliPath, ['read', '--data', data, '--limit', '3']).json.items.length, 1)
  })

  test('导出被改过就拒绝导入，目标目录一个字节不动（' + cliPath + '）', (t) => {
    const base = tmp(t)
    const data = path.join(base, 'data')
    const out = path.join(base, 'out')
    const data2 = path.join(base, 'data2')
    fs.mkdirSync(data, { recursive: true })
    fs.mkdirSync(out, { recursive: true })
    assert.equal(cli(cliPath, ['write', '--data', data, '--text', '要被校验的一条']).status, 0)
    const e = cli(cliPath, ['export', '--data', data, '--out', out]).json

    const target = path.join(e.dir, 'self-experience.jsonl')
    fs.appendFileSync(target, '\n', 'utf8')

    const i = cli(cliPath, ['import', '--data', data2, '--from', e.dir])
    assert.notEqual(i.status, 0)
    assert.match(i.json.error, /校验不通过/)
    assert.equal(fs.existsSync(path.join(data2, 'plugin-data', 'biomimetic-memory', 'self-experience.jsonl')), false)
  })
}