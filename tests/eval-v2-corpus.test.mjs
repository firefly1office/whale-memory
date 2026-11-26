// 阶段 2 评测集是生成出来的：产物要和脚本一致；负例与封存/抽屉边界在两种排序下都必须守住
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as exp from '../packages/core/lib/self-experience.js'
import { loadEvalV2, buildCorpus } from '../tools/lib/eval-v2-corpus.mjs'
import { safeRemove, tmpDir } from './_safety.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

test('评测集生成器：磁盘上的 corpus-v2 / cases-v2 与脚本逐字节一致', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'tools/gen-eval-v2.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(res.status, 0, (res.stdout || '') + (res.stderr || ''))
  assert.match(res.stdout, /一致/)
})

test('评测集结构：200 条经历、167 条新增、160+ 条用例、类型与 dev/holdout 都在', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'eval/corpus-v2.json'), 'utf8'))
  const caseFile = JSON.parse(fs.readFileSync(path.join(root, 'eval/cases-v2.json'), 'utf8'))
  const experiences = corpus.experiences
  assert.equal(experiences.length, 200)
  const nums = experiences.map((e) => Number(e.id.slice(1))).sort((a, b) => a - b)
  assert.deepEqual(nums, Array.from({ length: 200 }, (_, i) => i + 1), 'id 应当 e01…e200 连号')
  assert.equal(corpus.operations.length, 33)
  assert.ok(Object.keys(corpus.sealedMarkers).length >= 6)
  assert.ok(corpus.unsaidMarkers.length >= 6)
  assert.ok(caseFile.cases.length >= 160, '用例应不少于 160 条，实际 ' + caseFile.cases.length)
  const byType = {}
  for (const c of caseFile.cases) byType[c.type] = (byType[c.type] || 0) + 1
  for (const type of ['exact', 'paraphrase', 'combo', 'multiturn', 'none', 'near', 'sealed', 'drawer']) {
    assert.ok(byType[type] >= 5, '类型太少的用例说明覆盖面不够：' + type + ' = ' + byType[type])
  }
  assert.ok(byType.paraphrase >= 40 && byType.combo >= 20 && byType.multiturn >= 15, JSON.stringify(byType))
  const splits = new Set(caseFile.cases.map((c) => c.split))
  assert.deepEqual([...splits].sort(), ['dev', 'holdout'], '要有开发集和留出集')
  const seen = new Set()
  for (const c of caseFile.cases) {
    assert.ok(c.query && c.query.trim(), '查询不能为空：' + c.id)
    assert.ok(!seen.has(c.query), '查询重复：' + c.query)
    seen.add(c.query)
    if (c.expect !== null) assert.ok(experiences.some((e) => e.id === c.expect), '正例指向不存在的经历：' + c.id)
  }
})

test('负例与边界：literal / hybrid 都不许编，也不许把封存和抽屉漏出来', (t) => {
  const dir = tmpDir('whale-eval-v2-')
  t.after(() => safeRemove(dir))
  const { corpus, caseFile } = loadEvalV2(root)
  const { memoryDir } = buildCorpus(dir, corpus)
  const checks = caseFile.cases.filter((c) => ['none', 'near', 'sealed', 'drawer'].includes(c.type))
  for (const ranker of ['literal', 'hybrid']) {
    for (const c of checks) {
      const got = exp.recall(memoryDir, c.query, { limit: 10, ranker })
      const label = ranker + ' · ' + c.type + ' · ' + c.query
      if (c.type === 'none' || c.type === 'near') {
        assert.deepEqual(got.map((r) => r.id), [], '不存在的或沾边的事不该返回：' + label)
      } else if (c.type === 'sealed') {
        assert.ok(!got.some((r) => r.id === c.target), '封存的那条不该出现：' + label)
      } else {
        const text = got.map((r) => [r.then.text, r.then.thought].join(' ')).join('\n')
        assert.ok(!text.includes(c.marker), '抽屉里的话不该出现：' + label)
      }
    }
  }
})