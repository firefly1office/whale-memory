// 契约覆盖矩阵：文档说什么，测试就得测什么。**这一条不许靠人自觉。**
//
// 做法：
//   1. 从 docs/contract-v1-zh.md 正文里解析出所有条款号（§3.2-1 这种），附录 A 除外的正文；
//   2. 解析附录 A 的登记表（唯一登记处：条款 | 类别 | 说明）；
//   3. 正文与登记表必须一一对应——多一个少一个都红；
//   4. 类别是「承诺」的，tests/*.test.mjs 里至少有一个用例名带着这个号；
//   5. 类别是「流程」/「非承诺」的，说明栏不许空（写清为什么不能写成运行时断言）；
//   6. 反过来：测试名里出现的条款号必须在登记表里（不许自己编号、编个不存在的条款）；
//   7. 承诺条款数有下限——防止有人"砍条款"来让这条测试变绿。
//
// 它测的是**文档与测试的一致性**，不是实现行为；实现行为在 contract-v1.test.mjs 里。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const DOC = path.join(repo, 'docs', 'contract-v1-zh.md')
const TESTS = path.join(repo, 'tests')

const CLAUSE = /§\d+(?:\.\d+)?-\d+/g
const REGISTRY_ROW = /^\|\s*(§\d+(?:\.\d+)?-\d+)\s*\|\s*(承诺|流程|非承诺)\s*\|\s*(.*?)\s*\|\s*$/

const doc = fs.readFileSync(DOC, 'utf8')
const appendixAt = doc.indexOf('## 附录 A')
assert.ok(appendixAt > 0, '文档里找不到「## 附录 A · 条款登记表」——覆盖矩阵靠它认条款')
const body = doc.slice(0, appendixAt)
const appendix = doc.slice(appendixAt)

// ---- 正文里出现的条款号
const bodyIds = new Set(body.match(CLAUSE) || [])
// ---- 登记表
const registry = new Map()
for (const line of appendix.split('\n')) {
  const hit = line.match(REGISTRY_ROW)
  if (!hit) continue
  const [, id, kind, why] = hit
  assert.equal(registry.has(id), false, '附录 A 里同一条款登记了两次：' + id)
  registry.set(id, { kind, why: (why || '').trim() })
}
assert.ok(registry.size > 0, '附录 A 一条都没解析出来（表格格式改了？）')

// ---- 测试名
const testNames = []
for (const file of fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs'))) {
  const src = fs.readFileSync(path.join(TESTS, file), 'utf8')
  for (const m of src.matchAll(/\btest\(\s*(?:'([^']*)'|"([^"]*)")/g)) testNames.push(m[1] ?? m[2] ?? '')
}
assert.ok(testNames.length > 100, '读到的用例名太少了（' + testNames.length + '），解析规则可能过时')

// 用例名按文件归属，失败时报得出文件名
const namesByFile = new Map()
for (const file of fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs'))) {
  const src = fs.readFileSync(path.join(TESTS, file), 'utf8')
  const names = [...src.matchAll(/\btest\(\s*(?:'([^']*)'|"([^"]*)")/g)].map((m) => m[1] ?? m[2] ?? '')
  namesByFile.set(file, names)
}

test('契约覆盖矩阵：正文条款号与附录 A 登记表一一对应', () => {
  const texts = new Set(registry.keys())
  const missingInRegistry = [...bodyIds].filter((id) => !texts.has(id))
  const missingInBody = [...registry.keys()].filter((id) => !bodyIds.has(id))
  assert.deepEqual(missingInRegistry, [], '正文里有条款号没进登记表')
  assert.deepEqual(missingInBody, [], '登记表里有条款号正文里没写（说明它被删了条款却没删登记）')
})

test('契约覆盖矩阵：每个「承诺」条款都至少被一个契约测试名带着', () => {
  const committed = [...registry.entries()].filter(([, v]) => v.kind === '承诺').map(([id]) => id)
  assert.ok(committed.length >= 40, '承诺条款只有 ' + committed.length + ' 条，比 1.0 冻结时少——砍条款不能让它变绿')

  const uncovered = []
  for (const id of committed) {
    const carriers = []
    for (const [file, names] of namesByFile) {
      for (const name of names) if (name.includes(id)) carriers.push(file + ' :: ' + name)
    }
    if (!carriers.length) uncovered.push(id)
  }
  assert.deepEqual(uncovered, [], '这些承诺条款没有任何用例名带着它们的编号：' + uncovered.join(', '))
})

test('契约覆盖矩阵：「流程」与「非承诺」条款必须写明为什么不能写成测试', () => {
  const bad = []
  for (const [id, { kind, why }] of registry) {
    if (kind === '承诺') continue
    if (!why) bad.push(id + '（' + kind + '）')
  }
  assert.deepEqual(bad, [], '这些条款标了非承诺/流程却没写理由：' + bad.join(', '))
})

test('契约覆盖矩阵：用例名里的条款号必须真在登记表里（不许自己编号）', () => {
  const invented = new Set()
  for (const name of testNames) {
    for (const id of name.match(CLAUSE) || []) if (!registry.has(id)) invented.add(id)
  }
  assert.deepEqual([...invented], [], '这些编号在用例里出现、但文档没有：' + [...invented].join(', '))
})

test('契约覆盖矩阵：统计口径（承诺条款数 / 覆盖数 / 非承诺数）', () => {
  const committed = [...registry.entries()].filter(([, v]) => v.kind === '承诺').map(([id]) => id)
  const covered = committed.filter((id) => testNames.some((name) => name.includes(id)))
  const exempt = [...registry.entries()].filter(([, v]) => v.kind !== '承诺')
  // 同上，只是把数字打出来：这条测试自己不该变成"只要不为空就行"的摆设
  assert.equal(covered.length, committed.length, '有承诺条款没覆盖：' + (committed.length - covered.length))
  console.log(`契约覆盖：条款 ${registry.size} 条（承诺 ${committed.length} / 已覆盖 ${covered.length}）` +
    `；不纳入覆盖的 ${exempt.length} 条（` + exempt.map(([id, v]) => id + ' ' + v.kind).join('、') + '）')
})