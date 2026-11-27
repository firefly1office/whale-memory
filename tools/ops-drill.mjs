#!/usr/bin/env node
// N4 · 运维演练常态化：在临时目录里把整条链跑一遍——
//   造数据 → 备份 → 写入新数据 → 撤回一条 → 从备份恢复（已撤回的不复活）→ doctor
//   → 再擦除一条 → 再 doctor → 按字节搜残留 → 故意截断备份（必须报错，不许静默）
//
// 为什么要有它：备份、恢复、擦除、体检以前各自有演练（migrate-drill / restore-check），
// 但没有哪一条把"撤回之后再翻出旧备份"这种真实事故串起来验过。这条链就是那次事故的形状：
//   · 备份是在撤回**之前**打的 → 备份里还有那条；
//   · 恢复时如果照抄备份，她要求忘掉的东西就复活了；
//   · 恢复之后还要能体检、还能再撤一条，且正文不许在盘上留下字节。
//
// 每一步都记：名字、通过与否、耗时、说明（只写文件名 / 条数 / 字节数，不写正文）。
// 任何一步失败退出码 1；`--json` 给机器可读报告，贴给别人就能复现。
//
// 用法：
//   node tools/ops-drill.mjs                 # 跑完整条链，中文一行一步
//   node tools/ops-drill.mjs --json          # 机器可读报告
//   node tools/ops-drill.mjs --out=r.json    # 另外落一份 JSON
//   node tools/ops-drill.mjs --keep          # 保留临时目录（默认全绿就删；失败也保留）
//
// 全程只碰系统临时目录里的虚构数据，不读、不写任何真实记忆。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const libUrl = (name) => pathToFileURL(path.join(root, 'packages', 'core', 'lib', name)).href

const { addExperience, reviseExperience, setSealed, setUnfinishedState, linkExperiences, loadAll } = await import(libUrl('self-experience.js'))
const { eraseExperience } = await import(libUrl('erase.js'))
const archive = await import(libUrl('archive.js'))
const laterEvents = await import(libUrl('later-events.js'))
const sealEvents = await import(libUrl('seal-events.js'))
const recallEvents = await import(libUrl('recall-events.js'))
const unfinishedEvents = await import(libUrl('unfinished-events.js'))
const linkEvents = await import(libUrl('link-events.js'))
const chapterEvents = await import(libUrl('chapter-events.js'))
const tombstones = await import(libUrl('tombstones.js'))
const audit = await import(libUrl('audit.js'))
const unsaid = await import(libUrl('unsaid.js'))
const { backup } = await import(pathToFileURL(path.join(root, 'tools', 'backup.mjs')).href)
const { restoreCheck } = await import(pathToFileURL(path.join(root, 'tools', 'restore-check.mjs')).href)

const argv = process.argv.slice(2)
const flag = (name, dflt = null) => {
  const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='))
  if (!hit) return dflt
  if (hit === '--' + name) return true
  return hit.slice(name.length + 3)
}
const AS_JSON = Boolean(flag('json', false))
const KEEP = Boolean(flag('keep', false))
const OUT = String(flag('out', '') || '')

// ---------------------------------------------------------------- 小工具

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(p, out)
    else if (entry.isFile()) out.push(p)
  }
  return out
}

// 按字节找一段 UTF-8（不按行、不按 JSON：擦除后残留的可能是半行 / 墓碑 / 审计 / 页尾）
function countInTree(dir, text) {
  if (!fs.existsSync(dir)) return 0
  const needle = Buffer.from(String(text), 'utf8')
  let hits = 0
  for (const file of walkFiles(dir)) {
    let buf
    try { buf = fs.readFileSync(file) } catch { continue }
    for (let at = 0; ;) {
      at = buf.indexOf(needle, at)
      if (at < 0) break
      hits += 1
      at += needle.length
    }
  }
  return hits
}

function countsOf(mem) {
  const list = (mod) => mod.readAll(mem).rows.length
  return {
    records: loadAll(mem).length,
    later: list(laterEvents),
    seal: list(sealEvents),
    recall: list(recallEvents),
    unfinished: list(unfinishedEvents),
    links: list(linkEvents),
    chapters: list(chapterEvents),
    unsaid: (unsaid.listUnsaid(mem, { chatKey: 'local:owner', all: true }).items || []).length,
    tombstones: tombstones.readAll(mem).rows.length,
    auditErase: (audit.read(mem, { action: 'erase' }) || []).length
  }
}

function doctor(mem) {
  const res = spawnSync(process.execPath, [path.join(root, 'tools', 'doctor.mjs'), mem, '--json'], { encoding: 'utf8', timeout: 120000 })
  if (res.status !== 0) throw new Error('doctor 退出码 ' + res.status + '：' + String(res.stdout || '').slice(0, 400) + String(res.stderr || '').slice(0, 200))
  const report = JSON.parse(res.stdout)
  if (!report.ok) throw new Error('doctor 有红灯：' + JSON.stringify((report.checks || []).filter((c) => !c.ok).map((c) => c.name)))
  return report
}

// ---------------------------------------------------------------- 主流程

function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-ops-drill-'))
  const data = path.join(base, 'data')
  const mem = path.join(data, 'plugin-data', 'biomimetic-memory')
  const backups = path.join(base, 'backups')
  const tag = crypto.randomBytes(3).toString('hex')
  const marker = (n) => 'OPS-' + tag + '-' + n
  const findings = []
  const steps = []
  const report = { version: 1, at: new Date().toISOString(), node: process.version, platform: process.platform, dir: { base, mem, backups }, steps, findings, ok: false, verdict: '失败' }
  let failed = false
  const run = (name, fn) => {
    if (failed) return
    const t0 = Date.now()
    try {
      const detail = fn()
      steps.push({ name, ok: true, ms: Date.now() - t0, detail: String(detail || '') })
    } catch (error) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: String(error && error.message ? error.message : error) })
      failed = true
    }
  }
  // 每一步失败就停：后面的步骤都依赖前面那份数据，接着跑只会把同一处错重复报几遍
  let ids = []
  let backupInfo = null
  let erasedA = ''
  let erasedB = ''
  let postId = ''
  let before = null

  run('1. 造数据', () => {
    const createdAt = new Date().toISOString()
    for (let i = 0; i < 12; i += 1) {
      const row = addExperience(mem, {
        text: '演练记录 ' + i + '（标记 ' + marker(i) + '）：雨点砸在窗台上，屋里很静。',
        scene: i % 3 === 0 ? '窗边' : '',
        feeling: ['平静'],
        thought: i % 4 === 0 ? '写下来就轻一点' : '',
        unfinished: i === 3 ? '还没弄完的事' : '',
        kind: '日常'
      })
      ids.push(row.id)
    }
    reviseExperience(mem, { id: ids[1], thought: '演练后记一' })
    reviseExperience(mem, { id: ids[5], thought: '演练后记二（这条经历后面会被撤回）' })
    reviseExperience(mem, { id: ids[9], thought: '演练后记三' })
    setSealed(mem, { id: ids[2], sealed: true, note: '演练封存' })
    setUnfinishedState(mem, { id: ids[3], choice: 'done' })
    linkExperiences(mem, { from: ids[4], to: ids[6], reason: '演练：这两件事有关' })
    chapterEvents.open(mem, { name: '演练章节', from: createdAt.slice(0, 10) })
    const drawer = unsaid.leaveUnsaid(mem, { chatKey: 'local:owner', kind: 'draft', text: '演练没说出口的一句话' })
    if (!drawer.ok) throw new Error('抽屉写入失败：' + String(drawer.error || ''))
    before = countsOf(mem)
    if (before.records !== 12) throw new Error('造出来不是 12 条：' + before.records)
    return '12 条经历 / 后记 ' + before.later + ' / 封存 ' + before.seal + ' / 结案 ' + before.unfinished +
      ' / 联想 ' + before.links + ' / 章节 ' + before.chapters + ' / 抽屉 ' + before.unsaid
  })

  run('2. 备份（打完自检）', () => {
    backupInfo = backup({ data, out: backups, keep: 0 })
    const manifest = archive.verifyArchive(backupInfo.dir)
    if (!manifest.files.length) throw new Error('备份里一个文件都没有')
    report.backup = { dir: backupInfo.dir, files: backupInfo.files, bytes: backupInfo.bytes, counts: manifest.counts }
    return backupInfo.files + ' 个文件 / ' + backupInfo.bytes + ' 字节（SHA-256 全对）；备份里 ' + manifest.counts.experiences + ' 条经历'
  })

  run('3. 写入新数据（备份之后）', () => {
    const post = addExperience(mem, { text: '备份之后写的一条（标记 ' + marker('post') + '），不该在恢复后出现。' })
    postId = post.id
    reviseExperience(mem, { id: ids[0], thought: '备份之后的后记，也不该在恢复后出现' })
    const now = loadAll(mem).length
    if (now !== before.records + 1) throw new Error('写入之后条数不对：' + now)
    return '新写 1 条经历 + 1 条后记（现在 ' + now + ' 条）'
  })

  run('4. 撤回一条（备份里还有它）', () => {
    erasedA = ids[5]
    const res = eraseExperience(mem, { id: erasedA, reason: '演练：模拟她本人要求撤回', actor: 'self' })
    if (!res.ok || !res.tombstone || res.alreadyGone) throw new Error('撤回没按预期完成：' + JSON.stringify({ ok: res.ok, tombstone: res.tombstone, alreadyGone: res.alreadyGone }))
    if (loadAll(mem).length !== before.records) throw new Error('撤回后条数不对：' + loadAll(mem).length)
    return '撤回 1 条（留墓碑；现在 ' + loadAll(mem).length + ' 条）'
  })

  run('5. 从备份恢复（已撤回的不复活）', () => {
    const restored = archive.importArchive(backupInfo.dir, mem, { force: true })
    if (!restored.ok) throw new Error('恢复失败：' + JSON.stringify(restored))
    if (restored.skippedTombstoned !== 1) throw new Error('恢复时剔掉的已撤回记录数不对：' + restored.skippedTombstoned)
    const rows = loadAll(mem)
    if (rows.length !== before.records - 1) throw new Error('恢复后条数不对：' + rows.length + '（期望 ' + (before.records - 1) + '）')
    if (rows.some((r) => r.id === erasedA)) throw new Error('已撤回的那条复活了')
    if (rows.some((r) => r.id === postId)) throw new Error('备份之后写的那条不该出现在恢复结果里')
    if ((rows.find((r) => r.id === ids[0]).later || []).length !== 0) throw new Error('备份之后的后记不该出现')
    // 正文按字节：已撤回那条的正文在目录里一处都不许有
    const leakA = countInTree(mem, marker(5))
    if (leakA !== 0) throw new Error('恢复后已撤回那条的正文还有 ' + leakA + ' 处：' + marker(5))
    const after = countsOf(mem)
    if (after.records !== before.records - 1) throw new Error('恢复后条数不对（countsOf）：' + after.records)
    if (after.seal !== before.seal || after.chapters !== before.chapters || after.unsaid !== before.unsaid) throw new Error('封存/章节/抽屉没恢复齐：' + JSON.stringify({ before, after }))
    // 恢复只剔「记录」不剔「事件」：指向已撤回记录的事件行还会留在盘上（loadAll 不展示，但字节在）。
    // 这是本轮演练量到的现状，写成 finding，不在本段偷偷改核心行为。
    const orphan = fs.readFileSync(path.join(mem, 'later-events.jsonl'), 'utf8').split('\n')
      .filter((line) => line.trim())
      .filter((line) => { try { return JSON.parse(line).id === erasedA } catch { return false } }).length
    if (orphan) {
      findings.push({ level: 'note', text: '恢复只剔记录、不剔事件：备份里属于已撤回记录的 later 事件仍有 ' + orphan + ' 行留在盘上（loadAll 不展示，但字节在）。要彻底干净得改 importArchive，不在 N4 范围。' })
    }
    report.countsAfterRestore = after
    return '剔掉 1 条已撤回记录（' + rows.length + ' 条恢复）；之后写的新数据没有回来；正文按字节 0 命中'
  })

  run('6. 体检（恢复之后）', () => {
    const res = doctor(mem)
    return 'doctor 全绿（' + (res.checks || []).length + ' 项）'
  })

  run('7. 再擦除一条（恢复之后）', () => {
    erasedB = ids[7]
    const res = eraseExperience(mem, { id: erasedB, reason: '演练：恢复之后再撤一条', actor: 'self' })
    if (!res.ok || !res.tombstone) throw new Error('第二次撤回失败：' + JSON.stringify({ ok: res.ok, tombstone: res.tombstone }))
    if (loadAll(mem).length !== before.records - 2) throw new Error('第二次撤回后条数不对：' + loadAll(mem).length)
    return '撤回 1 条（现在 ' + loadAll(mem).length + ' 条；墓碑 ' + tombstones.readAll(mem).rows.length + ' 条）'
  })

  run('8. 再体检', () => {
    const res = doctor(mem)
    return 'doctor 全绿（' + (res.checks || []).length + ' 项）'
  })

  run('9. 按字节搜残留', () => {
    const hits = {
      erasedA_inMem: countInTree(mem, marker(5)),
      erasedB_inMem: countInTree(mem, marker(7)),
      postBackup_inMem: countInTree(mem, marker('post')),
      laterBody_inMem: countInTree(mem, '演练后记')
    }
    if (hits.erasedA_inMem || hits.erasedB_inMem || hits.postBackup_inMem) {
      throw new Error('盘上还有正文残留：' + JSON.stringify(hits))
    }
    // 备份与历史副本不追溯（契约 §6-1）：备份包和 pre-import 副本里还留着，这是预期行为，记成 finding
    const siblings = fs.existsSync(path.join(data, 'plugin-data'))
      ? fs.readdirSync(path.join(data, 'plugin-data')).filter((n) => n.startsWith('biomimetic-memory.pre-import-'))
      : []
    const inBackups = countInTree(backups, marker(5)) + countInTree(backups, marker(7))
    const inSiblings = siblings.reduce((n, name) => n + countInTree(path.join(data, 'plugin-data', name), marker(7)), 0)
    if (inBackups || inSiblings) {
      findings.push({ level: 'note', text: '备份不追溯（预期）：备份包里两处标记共 ' + inBackups + ' 命中，pre-import 历史副本里 ' + inSiblings + ' 处——擦除只动当前数据目录（契约 §6-1）。' })
    }
    report.byteSearch = { ...hits, backups: inBackups, preImport: inSiblings, files: walkFiles(mem).length }
    return '已撤回正文 0 命中；备份/历史副本按契约不追溯（' + inBackups + ' + ' + inSiblings + '，已记 note）'
  })

  run('10. 故意截断备份（必须报错，不许静默）', () => {
    const broken = path.join(base, 'broken-backup')
    fs.cpSync(backupInfo.dir, broken, { recursive: true })
    const victimName = 'self-experience.jsonl'
    const victim = path.join(broken, victimName)
    const buf = fs.readFileSync(victim)
    if (buf.length < 40) throw new Error('备份里的经历文件太小，截断测试没法做')
    fs.writeFileSync(victim, buf.subarray(0, buf.length - 7)) // 截断：SHA-256 立刻对不上
    let verifyFailed = false
    try { archive.verifyArchive(broken) } catch { verifyFailed = true }
    if (!verifyFailed) throw new Error('截断之后 verifyArchive 没有报错（静默通过）')
    const restore = restoreCheck({ from: broken })
    if (restore.ok || restore.verdict !== '不可恢复') throw new Error('restore-check 没判成不可恢复：' + JSON.stringify({ ok: restore.ok, verdict: restore.verdict }))
    // 直接 import 也必须拒绝，而且不能留下半截目标目录
    const target = path.join(base, 'restore-from-broken')
    let importFailed = false
    try { archive.importArchive(broken, target) } catch { importFailed = true }
    if (!importFailed) throw new Error('importArchive 接受了截断的备份')
    if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('被拒绝的导入留下了半截目录')
    return 'verifyArchive 拒绝、restore-check 判「不可恢复」、importArchive 拒绝且不留半截目录'
  })

  // ---------------------------------------------------------------- 收尾

  report.ok = !failed && steps.every((s) => s.ok) && steps.length === 10
  report.verdict = report.ok ? '通过' : '失败'
  report.ms = steps.reduce((n, s) => n + s.ms, 0)
  report.cleanup = report.ok && !KEEP ? '已删除临时目录' : '保留临时目录（' + base + '）'
  if (report.ok && !KEEP) {
    try { fs.rmSync(base, { recursive: true, force: true }) } catch { report.cleanup = '临时目录删不掉（' + base + '）' }
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8')
  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('')
    console.log('运维演练（临时目录，虚构数据 · Node ' + process.version + '）')
    for (const [i, s] of steps.entries()) console.log((s.ok ? '  ✔ ' : '  ✘ ') + s.name + '：' + s.detail + '（' + s.ms + ' ms）')
    if (findings.length) {
      console.log('')
      for (const f of findings) console.log('  · ' + (f.level === 'warn' ? '警告' : '记录') + '：' + f.text)
    }
    console.log('')
    console.log('结论：' + steps.filter((s) => s.ok).length + '/' + steps.length + ' 步通过（' + report.ms + ' ms）· ' + report.cleanup)
  }
  if (!report.ok) process.exitCode = 1
}

main()