// 0.15：没说出口的抽屉（unsaid）、一键备份（tools/backup.mjs）与恢复演练（tools/restore-check.mjs）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as waking from '../packages/core/lib/waking.js'
import * as mem from '../packages/core/lib/self-memory.js'
import * as unsaid from '../packages/core/lib/unsaid.js'
import { recap, renderRecap } from '../packages/core/lib/recap.js'
import { renderBook } from '../packages/core/lib/book.js'
import { backup } from '../tools/backup.mjs'
import { restoreCheck } from '../tools/restore-check.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLIS = [
  'adapters/cli/memory-cli.mjs',
  'examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs'
]
const OWNER = 'local:owner'

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-015-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const memOf = (data) => path.join(data, 'plugin-data', 'biomimetic-memory')
const read = (f) => fs.readFileSync(f, 'utf8')

test('抽屉：留下的话 recall / 醒来块 / read / memory / recap / book 都看不到；只有私聊里的 list 给', (t) => {
  const data = tmp(t)
  const dir = memOf(data)
  const row = exp.addExperience(dir, { text: '今天读完了灯塔', unfinished: '想知道船有没有回来' })
  const before = read(path.join(dir, 'self-experience.jsonl'))
  const secret = '其实我今天有点难过'
  const left = unsaid.leaveUnsaid(dir, { chatKey: OWNER, kind: 'draft', text: secret, reason: '不想让他担心' })
  assert.equal(left.ok, true)
  assert.match(left.id, /^unsaid_/)

  const surfaces = {
    recall: JSON.stringify(exp.recall(dir, secret, { mode: 'loose', limit: 9, includeSealed: true })),
    read: JSON.stringify(exp.loadAll(dir)),
    view: exp.renderTwoPart(exp.currentView(dir, row.id)),
    waking: waking.buildWakingBlock(data, OWNER, { now: new Date(Date.now() + 86400000) }),
    memory: JSON.stringify(mem.recall(dir, secret, { includeDiary: true, mode: 'loose' })),
    recap: renderRecap(recap(dir, { days: 7 })),
    book: renderBook(dir, { includeSealed: true })
  }
  for (const [name, text] of Object.entries(surfaces)) assert.ok(!text.includes(secret) && !text.includes('不想让他担心'), name + ' 不该看到抽屉')

  const mine = unsaid.listUnsaid(dir, { chatKey: OWNER })
  assert.deepEqual(mine.items.map((x) => [x.kind, x.text, x.reason, x.status]), [['draft', secret, '不想让他担心', 'open']])
  assert.equal(read(path.join(dir, 'self-experience.jsonl')), before, 'then 一字不改')
  const view = exp.currentView(dir, row.id)
  assert.equal(view.later.length, 0)
  assert.equal(Number(view.recalls || 0), 0)
})

test('抽屉：群聊和认不出的会话一律拒绝，而且什么都不写', (t) => {
  const dir = tmp(t)
  for (const chatKey of ['group_123', 'qq:group:1', 'discord:channel:9', '', undefined]) {
    assert.equal(unsaid.leaveUnsaid(dir, { chatKey, text: '不该写进去' }).ok, false, String(chatKey))
    assert.equal(unsaid.listUnsaid(dir, { chatKey }).ok, false, String(chatKey))
  }
  assert.equal(fs.existsSync(unsaid.eventsFile(dir)), false)
  const ok = unsaid.leaveUnsaid(dir, { chatKey: 'private_100000000', kind: 'question', text: '你那天为什么不说话' })
  assert.equal(ok.ok, true)
  assert.equal(unsaid.markUnsaidSpoken(dir, { chatKey: 'group_123', id: ok.id }).ok, false)
  assert.equal(unsaid.discardUnsaid(dir, { chatKey: 'group_123', id: ok.id }).ok, false)
  assert.equal(unsaid.listUnsaid(dir, { chatKey: 'private_100000000' }).items[0].status, 'open')
})

test('抽屉：说出口 / 丢掉都是追加事件，原文不删；重复标记不写第二条；丢掉后她自己也看不到', (t) => {
  const dir = tmp(t)
  const a = unsaid.leaveUnsaid(dir, { chatKey: OWNER, kind: 'draft', text: '想跟他说声谢谢' })
  const b = unsaid.leaveUnsaid(dir, { chatKey: OWNER, kind: 'held', text: '那天其实很委屈' })
  assert.equal(unsaid.leaveUnsaid(dir, { chatKey: OWNER, kind: 'draft', text: '想跟他说声谢谢' }).noop, true, '同一句还开着时不重复留')
  assert.equal(unsaid.markUnsaidSpoken(dir, { chatKey: OWNER, id: a.id }).noop, false)
  assert.equal(unsaid.markUnsaidSpoken(dir, { chatKey: OWNER, id: a.id }).noop, true)
  assert.equal(unsaid.discardUnsaid(dir, { chatKey: OWNER, id: b.id }).noop, false)
  assert.equal(unsaid.discardUnsaid(dir, { chatKey: OWNER, id: b.id }).noop, true)
  assert.match(unsaid.markUnsaidSpoken(dir, { chatKey: OWNER, id: b.id }).error, /已经丢掉了/)
  assert.match(unsaid.markUnsaidSpoken(dir, { chatKey: OWNER, id: 'unsaid_nope' }).error, /没有这一条/)

  assert.deepEqual(unsaid.listUnsaid(dir, { chatKey: OWNER }).items, [], '默认只给开着的')
  const all = unsaid.listUnsaid(dir, { chatKey: OWNER, all: true }).items
  assert.deepEqual(all.map((x) => [x.id, x.status]), [[a.id, 'spoken']], '丢掉的连 all 也不给')
  assert.ok(all[0].spokenDay)

  const raw = read(unsaid.eventsFile(dir)).trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(raw.length, 4, '两条留下 + 一次说出口 + 一次丢掉')
  assert.ok(raw.some((r) => r.text === '那天其实很委屈'), '原文还在文件里')
  assert.equal(unsaid.leaveUnsaid(dir, { chatKey: OWNER, kind: 'shout', text: 'x' }).ok, false)
  assert.equal(unsaid.leaveUnsaid(dir, { chatKey: OWNER, text: '长'.repeat(1001) }).ok, false)
})

test('抽屉：两个进程同时说出口同一条，只记一次', async (t) => {
  const dir = tmp(t)
  const a = unsaid.leaveUnsaid(dir, { chatKey: OWNER, text: '想说的话' })
  const worker = path.join(dir, 'w.mjs')
  fs.writeFileSync(worker, `import * as u from ${JSON.stringify(new URL('../packages/core/lib/unsaid.js', import.meta.url).href)}\nprocess.exit(u.markUnsaidSpoken(process.argv[2], { chatKey: 'local:owner', id: process.argv[3] }).ok ? 0 : 1)\n`)
  await Promise.all([0, 1, 2].map(() => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [worker, dir, a.id], { stdio: 'ignore' })
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker ' + code))))
  })))
  assert.equal(read(unsaid.eventsFile(dir)).trim().split('\n').length, 2)
})

function seed(data) {
  const dir = memOf(data)
  const a = exp.addExperience(dir, { text: '读完灯塔', unfinished: '船回来没有', feeling: ['闷'] })
  const b = exp.addExperience(dir, { text: '那天被当众批评' })
  const c = exp.addExperience(dir, { text: '店长把钥匙交给我', refs: [a.id] })
  exp.reviseExperience(dir, { id: a.id, thought: '船回来了', feeling: ['释然'] })
  exp.setUnfinishedState(dir, { id: a.id, choice: 'done' })
  exp.setSealed(dir, { id: b.id, sealed: true })
  exp.markRecalled(dir, a.id)
  exp.linkExperiences(dir, { from: a.id, to: c.id, reason: '都是被接住' })
  unsaid.leaveUnsaid(dir, { chatKey: OWNER, text: '其实有点难过' })
  return { a, b, c }
}

test('备份：打包、立即自检、只轮换自己建的；拒绝放进数据根', (t) => {
  const data = tmp(t), out = tmp(t)
  seed(data)
  fs.mkdirSync(path.join(out, '别的东西'))
  fs.mkdirSync(path.join(out, 'memory-backup-假的'))
  const made = []
  for (let i = 0; i < 3; i++) {
    made.push(backup({ data, out, keep: 2 }))
    const until = Date.now() + 5; while (Date.now() < until) { /* 名字按毫秒区分 */ }
  }
  assert.ok(made.every((m) => m.ok))
  const left = fs.readdirSync(out).sort()
  assert.deepEqual(left.filter((n) => n.startsWith('memory-backup-2')), [made[1], made[2]].map((m) => path.basename(m.dir)).sort())
  assert.ok(left.includes('别的东西') && left.includes('memory-backup-假的'), '不是自己建的不碰')
  assert.equal(made[2].removed.length, 1)
  assert.throws(() => backup({ data, out: path.join(data, 'backups') }), /不能放在数据根里面/)
  assert.throws(() => backup({ data, out: path.join(data, 'plugin-data', 'x') }), /不能放在数据根里面/)
})

test('恢复演练：备份 → 删掉原目录 → 恢复，then / 后记 / 想起 / 结案 / 封存 / 联想 / 抽屉全一致；输出不带原文', (t) => {
  const data = tmp(t), out = tmp(t)
  const { a, b } = seed(data)
  const snapshot = exp.loadAll(memOf(data))
  const bk = backup({ data, out })

  const check = restoreCheck({ from: bk.dir, data })
  assert.equal(check.verdict, '可恢复，且与原数据一致', JSON.stringify(check.checks))
  for (const s of ['读完灯塔', '批评', '其实有点难过', '释然']) assert.ok(!JSON.stringify(check).includes(s), '报告里不该有原文：' + s)

  // 真的删掉再恢复：用 CLI 的 import
  fs.rmSync(memOf(data), { recursive: true, force: true })
  const r = spawnSync(process.execPath, [path.join(root, CLIS[0]), 'import', '--from', bk.dir, '--data', data], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout)
  const back = exp.loadAll(memOf(data))
  assert.deepEqual(back.map((x) => x.id), snapshot.map((x) => x.id))
  const va = exp.currentView(memOf(data), a.id)
  assert.equal(va.unfinishedState.choice, 'done')
  assert.equal(va.recalls, 1)
  assert.deepEqual(va.later.map((l) => l.feeling), [['释然']])
  assert.ok(exp.currentView(memOf(data), b.id).sealed, '封存跟着回来')
  assert.equal(exp.recall(memOf(data), '批评').length, 0)
  assert.equal(unsaid.listUnsaid(memOf(data), { chatKey: OWNER }).items.length, 1, '抽屉跟着回来')
})

test('恢复演练：改坏备份里一个字节 → 不可恢复，退出码 1；缺文件也一样', (t) => {
  const data = tmp(t), out = tmp(t)
  seed(data)
  const bk = backup({ data, out })
  const f = path.join(bk.dir, 'self-experience.jsonl')
  const buf = fs.readFileSync(f); buf[10] ^= 1; fs.writeFileSync(f, buf)
  const r = restoreCheck({ from: bk.dir })
  assert.equal(r.verdict, '不可恢复')
  assert.match(r.checks[0].detail, /文件校验不通过：self-experience\.jsonl/)
  const cli = spawnSync(process.execPath, [path.join(root, 'tools/restore-check.mjs'), '--from', bk.dir], { encoding: 'utf8' })
  assert.equal(cli.status, 1)

  const bk2 = backup({ data, out })
  fs.rmSync(path.join(bk2.dir, 'unsaid-events.jsonl'))
  assert.match(restoreCheck({ from: bk2.dir }).checks[0].detail, /缺少文件：unsaid-events\.jsonl/)
})

test('恢复演练：备份之后她又写了东西 → 可恢复，但如实报差异（退出码 2）', (t) => {
  const data = tmp(t), out = tmp(t)
  const { a } = seed(data)
  const bk = backup({ data, out })
  exp.reviseExperience(memOf(data), { id: a.id, thought: '又想了想' })
  const r = restoreCheck({ from: bk.dir, data })
  assert.equal(r.verdict, '可恢复，但与原数据有差异')
  assert.deepEqual(r.diffs, [{ id: a.id, field: 'later' }])
  const cli = spawnSync(process.execPath, [path.join(root, 'tools/restore-check.mjs'), '--from', bk.dir, '--data', data], { encoding: 'utf8' })
  assert.equal(cli.status, 2)
})

for (const script of CLIS) {
  test('CLI：unsaid leave / list / spoken / discard；群聊拒绝；doctor 抽屉不外露（' + script + '）', (t) => {
    const data = tmp(t)
    const run = (args) => {
      const r = spawnSync(process.execPath, [path.join(root, script), ...args, '--data', data], { encoding: 'utf8' })
      return { code: r.status, json: JSON.parse(r.stdout) }
    }
    run(['write', '--text', '今天读完了灯塔'])
    const id = run(['unsaid', 'leave', '--kind', 'question', '--text', '你那天为什么不说话', '--reason', '怕他为难']).json.id
    assert.match(id, /^unsaid_/)
    assert.equal(run(['unsaid', 'list', '--chat', 'group_123']).code, 1)
    assert.equal(run(['unsaid', 'list']).json.items[0].kind, 'question')
    assert.ok(!JSON.stringify(run(['read']).json).includes('为什么不说话'))
    assert.ok(!JSON.stringify(run(['recall', '--query', '为什么不说话', '--mode', 'loose']).json).includes('为什么不说话'))
    assert.equal(run(['unsaid', 'spoken', '--id', id]).json.noop, false)
    assert.equal(run(['unsaid', 'spoken', '--id', id]).json.noop, true)
    assert.equal(run(['unsaid', 'list', '--all', 'true']).json.items[0].status, 'spoken')
    assert.equal(run(['unsaid', 'discard', '--id', id]).json.noop, false)
    assert.deepEqual(run(['unsaid', 'list', '--all', 'true']).json.items, [])
    const doc = run(['doctor']).json
    assert.equal(doc.ok, true, JSON.stringify(doc.checks))
    assert.ok(doc.checks.some((c) => c.name.startsWith('抽屉不外露')))
  })
}

test('备份 --keep 0：一份都不删，全部留着', (t) => {
  const data = tmp(t), out = tmp(t)
  seed(data)
  const made = []
  for (let i = 0; i < 4; i++) {
    made.push(backup({ data, out, keep: 0 }))
    const until = Date.now() + 5; while (Date.now() < until) { /* 名字按毫秒区分 */ }
  }
  assert.ok(made.every((m) => m.ok && m.removed.length === 0))
  assert.equal(fs.readdirSync(out).filter((n) => n.startsWith('memory-backup-2')).length, 4)
  assert.equal(made[3].kept.length, 4)
  assert.throws(() => backup({ data, out, keep: -1 }), /0 到 365/)
})

test('恢复演练：原数据里本来就有一行坏的事件，如实备份不算"不可恢复"；备份里多出来的坏行才算', (t) => {
  const data = tmp(t), out = tmp(t)
  seed(data)
  const m = memOf(data)
  fs.appendFileSync(path.join(m, 'later-events.jsonl'), '{这一行是坏的\n')
  const bk = backup({ data, out })
  const r = restoreCheck({ from: bk.dir, data })
  assert.notEqual(r.verdict, '不可恢复', JSON.stringify(r.checks))
  assert.match(r.checks.find((c) => c.name === '事件文件没有坏行').detail, /原数据里本来就有 1 行/)
  // 备份包里多坏一行：校验和就不对了，整包不可恢复
  fs.appendFileSync(path.join(bk.dir, 'later-events.jsonl'), '{又坏一行\n')
  assert.equal(restoreCheck({ from: bk.dir, data }).verdict, '不可恢复')
})
