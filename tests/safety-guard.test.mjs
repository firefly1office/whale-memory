import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { assertUnderTmp, safeRemove } from './_safety.mjs'

test('拒绝删除临时目录之外的目标', () => {
  const danger = path.join('C:', 'Users', 'someone', 'data', 'plugin-data', 'memory')
  assert.throws(() => assertUnderTmp(danger), /拒绝在临时目录之外/)
  assert.throws(() => safeRemove(danger), /拒绝在临时目录之外/)
})

test('拒绝时不动文件', () => {
  const file = path.resolve('package.json')
  assert.ok(fs.existsSync(file))
  assert.throws(() => safeRemove(file), /拒绝在临时目录之外/)
  assert.ok(fs.existsSync(file), '拒绝之后文件必须还在')
})

test('允许删除自己造的临时目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-safety-'))
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x')
  safeRemove(dir)
  assert.equal(fs.existsSync(dir), false)
})

test('拒绝删除系统临时目录本身', () => {
  assert.throws(() => safeRemove(os.tmpdir()), /临时目录本身/)
})