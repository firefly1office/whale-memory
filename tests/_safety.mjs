// 测试清理护栏：只允许删除**本次测试自己造出来的**目录。
//
// 事故（2026-11-22）：一条用例先从运行环境推算出数据目录，之后才设临时目录；
// 加载失败时 finally 仍然执行，把真实数据目录整棵删掉。
//
// 第一版护栏查的是「路径在不在系统临时目录下」——这是黑名单式启发：
// 仓库本身被 clone 到 /tmp 时，package.json 也在 /tmp 下，于是被放行、被删掉。
// 现在改成白名单：只有经 tmpDir()/registerTmpRoot() 明确登记过的根，
// 以及它下面的路径，才允许递归删除。其它一律拒绝。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const roots = new Set()

const norm = (p) => {
  const r = path.resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

function within(root, target) {
  const base = norm(root)
  const p = norm(target)
  return p === base || p.startsWith(base + path.sep)
}

/** 造一个临时目录并登记为可删除的根。测试里凡是需要清理的目录都该用它。 */
export function tmpDir(prefix = 'whale-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.add(norm(dir))
  return dir
}

/** 给已经造好的目录登记（例如第三方 helper 里 mkdtemp 出来的）。 */
export function registerTmpRoot(dir) {
  // 先拒空再 resolve：path.resolve('') 会变成当前工作目录，等于把仓库登记成可删。
  const raw = String(dir || '').trim()
  if (!raw) throw new Error('空路径不能登记')
  const resolved = path.resolve(raw)
  const cwd = norm(process.cwd())
  const target = norm(resolved)
  // 也不能登记工作目录的上级：那会把 cwd 和整个仓库都放进可删范围。
  if (cwd === target || cwd.startsWith(target + path.sep)) throw new Error('不能登记包含当前工作目录的目录：' + resolved)
  const st = fs.statSync(resolved)
  if (!st.isDirectory()) throw new Error('只能登记目录：' + resolved)
  roots.add(target)
  return resolved
}

/** 只读检查：这个路径在不在登记过的根下面。不删除任何东西。 */
export function assertRegistered(target) {
  const resolved = path.resolve(String(target || ''))
  for (const root of roots) {
    if (within(root, resolved)) return resolved
  }
  const error = new Error('拒绝删除未登记的路径（只允许本次测试自己造的临时目录）：' + resolved)
  error.code = 'TEST_UNSAFE_REMOVE'
  throw error
}

export function safeRemove(target, options = {}) {
  const resolved = assertRegistered(target)
  fs.rmSync(resolved, { recursive: true, force: true, ...options })
}