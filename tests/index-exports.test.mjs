// 包入口的导出必须两边对齐：index.js 有的，index.d.ts 也得有，反过来也一样。
// 之前 index.d.ts 比 index.js 少 7 个（scopeKey / conversationPrivacy / factCard / factStore /
// factJudge / changed / injection），类型冒烟测又没 import 它们，所以一直没红。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// 只看顶层导出语句：`export * as X from '...'` 与 `export { a, b as c } from '...'`
function exportNames(source) {
  const names = []
  for (const m of source.matchAll(/^export \* as (\w+) from /gm)) names.push(m[1])
  for (const m of source.matchAll(/^export \{([^}]+)\} from /gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) names.push(name.trim())
    }
  }
  return names.sort()
}

test('包入口：index.d.ts 与 index.js 的导出一一对应', async () => {
  const js = exportNames(read('packages/core/index.js'))
  const dts = exportNames(read('packages/core/index.d.ts'))
  assert.ok(js.length >= 20, 'index.js 的导出数看起来不对：' + js.length)

  const missingInTypes = js.filter((n) => !dts.includes(n))
  const missingInJs = dts.filter((n) => !js.includes(n))
  assert.deepEqual(missingInTypes, [], 'index.d.ts 少了这些导出：' + missingInTypes.join(', '))
  assert.deepEqual(missingInJs, [], 'index.d.ts 多了这些 index.js 没有的导出：' + missingInJs.join(', '))
  assert.deepEqual(dts, js, 'index.js 与 index.d.ts 的导出顺序/名字要对齐')

  // 运行时也得真的能拿到：防止 d.ts 写了、js 忘了
  const mod = await import('../packages/core/index.js')
  assert.deepEqual(Object.keys(mod).sort(), js, 'index.js 实际导出的名字要和文件里写的一致')
  for (const name of Object.keys(mod)) assert.ok(mod[name] !== undefined && mod[name] !== null, name + ' 导出了空值')
})

test('包入口：曾经漏掉的 7 个模块现在都从入口导出', async () => {
  const mod = await import('../packages/core/index.js')
  for (const name of ['scopeKey', 'conversationPrivacy', 'factCard', 'factStore', 'factJudge', 'changed', 'injection']) {
    assert.equal(typeof mod[name], 'object', name + ' 应该从包入口导出')
  }
})