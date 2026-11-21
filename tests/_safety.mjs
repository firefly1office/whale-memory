// 测试清理护栏：只允许删除临时目录。
//
// 背景（2026-11-22，见 docs/postmortem-2026-11-22.md）：一条用例先从运行环境推算出
// 数据目录、之后才设置自己的临时目录；加载失败时 finally 仍然执行，把真实数据目录
// 整棵删掉。教训不是"下次小心"，而是**让删除动作在越过临时目录时直接失败**。
//
// 规则：测试里任何递归删除都走 safeRemove()；目标必须在系统临时目录下。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP_ROOT = (() => {
  const raw = path.resolve(os.tmpdir())
  return process.platform === 'win32' ? raw.toLowerCase() : raw
})()

export function assertUnderTmp(target) {
  const resolved = path.resolve(String(target || ''))
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const within = normalized === TMP_ROOT || normalized.startsWith(TMP_ROOT + path.sep)
  if (!within) {
    const error = new Error('拒绝在临时目录之外做递归删除：' + resolved)
    error.code = 'TEST_UNSAFE_REMOVE'
    throw error
  }
  if (normalized === TMP_ROOT) {
    const error = new Error('拒绝删除系统临时目录本身')
    error.code = 'TEST_UNSAFE_REMOVE'
    throw error
  }
  return resolved
}

export function safeRemove(target, options = {}) {
  fs.rmSync(assertUnderTmp(target), { recursive: true, force: true, ...options })
}