// 显式导出：封存状态读不出来时，不能拿空文件覆盖上一次成功的书。
//
// 复审（96534ef）：先导出成功 258 字节，再把封存日志弄坏，向同一文件再导一次，
// CLI 退出 0、ok:true，文件变成 0 字节。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { addExperience } from '../packages/core/lib/self-experience.js'
import { tmpDir } from './_safety.mjs'

const CLI = new URL('../adapters/cli/memory-cli.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

function seed() {
  const data = tmpDir('cli-book-data-')
  const mem = path.join(data, 'plugin-data', 'biomimetic-memory')
  fs.mkdirSync(mem, { recursive: true })
  addExperience(mem, { text: '夜里翻完灯塔那章，守灯人整晚没睡', thought: '她是在等人' })
  return { data, mem }
}

const run = (args) => spawnSync(process.execPath, [decodeURIComponent(CLI), ...args], { encoding: 'utf8' })

test('导出成功一次后，封存日志坏了再导：保旧文件、退出非零', () => {
  const { data, mem } = seed()
  const outFile = path.join(tmpDir('cli-book-out-'), 'book.md')

  const first = run(['book', '--data', data, '--out', outFile])
  assert.equal(first.status, 0, first.stdout + first.stderr)
  const before = fs.readFileSync(outFile)
  assert.ok(before.length > 0)

  // 让封存日志读不出来
  fs.rmSync(path.join(mem, 'seal-events.jsonl'), { force: true })
  fs.mkdirSync(path.join(mem, 'seal-events.jsonl'))

  const second = run(['book', '--data', data, '--out', outFile])
  assert.notEqual(second.status, 0, '导出失败应返回非零：' + second.stdout)
  assert.equal(fs.readFileSync(outFile).compare(before), 0, '旧文件不能被清空或改写')
})

test('日志里有一行坏掉：同样保旧文件、退出非零', () => {
  const { data, mem } = seed()
  const outFile = path.join(tmpDir('cli-book-out-'), 'book.md')
  assert.equal(run(['book', '--data', data, '--out', outFile]).status, 0)
  const before = fs.readFileSync(outFile)

  fs.writeFileSync(path.join(mem, 'seal-events.jsonl'), '{"id":"x","action":"seal", 坏行\n', 'utf8')
  const second = run(['book', '--data', data, '--out', outFile])
  assert.notEqual(second.status, 0)
  assert.equal(fs.readFileSync(outFile).compare(before), 0)
})