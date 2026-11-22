// 护栏自身的验收：白名单，不是「看起来像临时目录」。
//
// 监督意见（2026-11-22，Leo 的研究伙伴）：第一版查的是「路径在 os.tmpdir() 下」，
// 仓库被 clone 到 /tmp 时 package.json 也在 /tmp 下，于是被放行、被删掉。
// 这组用例专门盯住那个场景：只有本次测试登记过的根才可删。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { assertRegistered, registerTmpRoot, safeRemove, tmpDir } from './_safety.mjs'

test('拒绝删除仓库里的文件（哪怕仓库就在临时目录下）', () => {
  const file = path.resolve('package.json')
  assert.ok(fs.existsSync(file), '工作区应有 package.json')
  assert.throws(() => assertRegistered(file), /拒绝删除未登记的路径/)
  assert.throws(() => safeRemove(file), /拒绝删除未登记的路径/)
  assert.ok(fs.existsSync(file), '拒绝之后文件必须原样还在')
})

test('拒绝删除未登记的临时目录（例如别处 mkdtemp 出来的）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unregistered-'))
  try {
    assert.throws(() => safeRemove(dir), /拒绝删除未登记的路径/)
    assert.ok(fs.existsSync(dir), '未登记的目录不能被删')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('允许删除自己登记的临时目录', () => {
  const dir = tmpDir('whale-safety-')
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x')
  safeRemove(dir)
  assert.equal(fs.existsSync(dir), false)
})

test('登记过的根：里面的文件可以删，根本身也可以删', () => {
  const dir = tmpDir('whale-safety-nested-')
  const child = path.join(dir, 'a', 'b.txt')
  fs.mkdirSync(path.dirname(child), { recursive: true })
  fs.writeFileSync(child, 'x')
  safeRemove(child)
  assert.equal(fs.existsSync(child), false)
  safeRemove(dir)
  assert.equal(fs.existsSync(dir), false)
})

test('registerTmpRoot 可以把已有目录纳入白名单', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopted-'))
  try {
    assert.throws(() => safeRemove(dir), /拒绝删除未登记的路径/)
    registerTmpRoot(dir)
    safeRemove(dir)
    assert.equal(fs.existsSync(dir), false)
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 已删 */ }
  }
})
test('registerTmpRoot 拒绝空参数（不能把当前目录登记成可删）', () => {
  assert.throws(() => registerTmpRoot(''), /空路径不能登记/)
  assert.throws(() => registerTmpRoot('   '), /空路径不能登记/)
  assert.throws(() => registerTmpRoot(process.cwd()), /当前工作目录/)
})