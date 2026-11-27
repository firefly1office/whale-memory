// N2 · 增长曲线的冒烟测试：工具能跑、JSON 结构齐、条数和阶梯对得上、拐点字段在。
//
// 不在测试里跑 20 万（那是基准，不是单测）：用 200 → 600 两档、每档 3 次写入，几秒跑完。
// 真正的 20 万数字见 docs/scale-zh.md「二·补」。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { tmpDir, safeRemove } from './_safety.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const TOOL = path.join(REPO, 'tools/bench-growth.mjs')

test('N2：bench-growth 两档冒烟——JSON 结构齐、条数对、拐点有结论、写入真走 addExperience', (t) => {
  const base = tmpDir('wm-n2-growth-')
  t.after(() => safeRemove(base))
  const out = path.join(base, 'growth.json')
  const res = spawnSync(process.execPath, [TOOL, '--steps=200,600', '--samples=3', '--dir=' + path.join(base, 'bench'), '--json', '--out=' + out], {
    encoding: 'utf8',
    timeout: 300000
  })
  assert.equal(res.status, 0, '基准工具退出 ' + res.status + '：' + String(res.stderr || '').split('\n').slice(0, 8).join(' '))
  assert.equal(fs.existsSync(out), true, '--out 要落一份 JSON')
  const report = JSON.parse(fs.readFileSync(out, 'utf8'))

  // 阶梯与条数
  assert.deepEqual(report.steps, [200, 600])
  assert.equal(report.curve.length, 2)
  assert.equal(report.curve[0].records, 200)
  assert.equal(report.curve[1].records, 600)
  assert.equal(report.corpus.records, 600)
  assert.equal(report.corpus.spanDays, 90)
  // 事件真的写进去了（不是只有主文件）
  assert.ok(report.corpus.later > 0 && report.corpus.seal > 0 && report.corpus.recall > 0, '后记/封存/想起都要有')

  for (const step of report.curve) {
    assert.equal(typeof step.write.medianMs, 'number')
    assert.equal(step.write.samples, 3, '每档真写 3 次')
    assert.ok(step.write.perSec > 0)
    assert.ok(step.loadAll.medianMs > 0)
    assert.ok(step.loadAll.peakRssMB >= report.baselineRssMB, '峰值不可能比基线低')
    assert.ok(step.iterate.ms > 0)
    assert.ok(step.page.medianMs > 0)
    assert.ok(step.page.firstMs > 0)
    assert.ok(step.recall.medianMs > 0)
    assert.equal(typeof step.indexRebuildMs, 'number')
    assert.ok(step.indexRebuildMs >= 0)
  }

  // 拐点：要么给出档位与理由，要么明确说"没有明显拐点"——不能留空
  assert.ok('step' in report.knee, 'knee.step 必须在')
  assert.ok(typeof report.knee.note === 'string' && report.knee.note.length > 0, '拐点要给结论')
  if (report.knee.step === null) assert.match(report.knee.note, /拐点/)

  // 增长确实落在同一个目录里（不重建）：第二档的条数是第一档的 3 倍，文件只有一个
  const mem = path.join(path.join(base, 'bench'), 'mem')
  assert.equal(fs.existsSync(path.join(mem, 'self-experience.jsonl')), true)
  assert.equal(fs.readFileSync(path.join(mem, 'self-experience.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).length, 600)
})