#!/usr/bin/env node
// 恢复演练：这份备份真的能恢复成同一份记忆吗？
// 用法：node tools/restore-check.mjs --from <备份包目录> [--data <原数据根目录>]
//   1. 校验整包：manifest 合法、每个文件都在、SHA-256 一致；任何一处不对 → 不可恢复
//   2. 导入到临时目录，确认能读出来、事件文件没有坏行、出处都在
//   3. 给了 --data 时，逐条比对原数据与恢复后的：then、later、想起次数、未完状态、封存（还有联想、章节、抽屉条数）
// 输出只有 id、字段名和数字，不打印任何原文。全程不改原数据，临时目录用完即删
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as archive from '../packages/core/lib/archive.js'
import { loadAll } from '../packages/core/lib/self-experience.js'
import * as laterEvents from '../packages/core/lib/later-events.js'
import * as recallEvents from '../packages/core/lib/recall-events.js'
import * as unfinishedEvents from '../packages/core/lib/unfinished-events.js'
import * as sealEvents from '../packages/core/lib/seal-events.js'
import * as linkEvents from '../packages/core/lib/link-events.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import * as unsaid from '../packages/core/lib/unsaid.js'

// 一条经历里要比对的东西；都转成字符串比，避免键顺序以外的偶然差异
function fingerprint(r) {
  return {
    then: JSON.stringify(r.then),
    later: JSON.stringify((r.later || []).map((l) => ({ at: l.at, thought: l.thought, reason: l.reason || '', feeling: l.feeling || [] }))),
    recalls: Number(r.recalls || 0),
    unfinishedState: JSON.stringify(r.unfinishedState ? { choice: r.unfinishedState.choice, history: r.unfinishedState.history } : null),
    sealed: JSON.stringify(r.sealed ? { day: r.sealed.day } : null),
    links: JSON.stringify((r.links || []).map((l) => l.id).sort()),
    chapters: JSON.stringify((r.chapters || []).map((c) => c.id).sort())
  }
}

function drawer(memDir) {
  const res = unsaid.listUnsaid(memDir, { chatKey: 'local:owner', all: true })
  if (!res.ok) return { open: 0, spoken: 0 }
  return { open: res.items.filter((x) => x.status === 'open').length, spoken: res.items.filter((x) => x.status === 'spoken').length }
}

function badLines(memDir) {
  return [laterEvents, recallEvents, unfinishedEvents, sealEvents, linkEvents, chapterEvents].reduce((n, m) => n + m.readAll(memDir).bad, 0) + unsaid.badLines(memDir)
}

export function restoreCheck({ from, data = '' }) {
  if (!from) throw new Error('需要 --from <备份包目录>')
  const report = { ok: false, verdict: '不可恢复', from: path.resolve(from), checks: [] }
  const check = (name, ok, detail) => report.checks.push({ name, ok: Boolean(ok), detail })

  let manifest
  try { manifest = archive.verifyArchive(from) } catch (e) {
    check('备份包完整', false, String(e.message || e))
    return report
  }
  check('备份包完整', true, manifest.files.length + ' 个文件，SHA-256 全部一致')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-restore-check-'))
  try {
    const restored = path.join(tmp, 'plugin-data', 'biomimetic-memory')
    archive.importArchive(from, restored)
    const rows = loadAll(restored)
    const bad = badLines(restored)
    check('恢复后能读', true, rows.length + ' 条经历')
    // 原数据里本来就有的坏行（插件读的时候会跳过），备份如实带上不算备份坏了；只有比原数据多出来的才算
    let origBad = null
    if (data) { const om = path.join(path.resolve(data), 'plugin-data', 'biomimetic-memory'); if (fs.existsSync(om)) { try { origBad = badLines(om) } catch { origBad = null } } }
    const badOk = bad === 0 || (origBad !== null && bad <= origBad)
    check('事件文件没有坏行', badOk, bad === 0 ? '没有坏行' : badOk ? '有 ' + bad + ' 行解析失败，原数据里本来就有 ' + origBad + ' 行（读的时候会跳过），备份如实带上了' : bad + ' 行解析失败' + (origBad !== null ? '（原数据里只有 ' + origBad + ' 行）' : ''))
    const missing = rows.flatMap((r) => (r.refsInfo || []).filter((x) => x.missing).map((x) => r.id + '→' + x.id))
    check('出处都在', missing.length === 0, missing.length ? missing.length + ' 处出处指向找不到的经历' : '每条回想引用的经历都在')

    if (data) {
      const origMem = path.join(path.resolve(data), 'plugin-data', 'biomimetic-memory')
      if (!fs.existsSync(origMem)) {
        check('与原数据一致', false, '找不到原数据：' + origMem)
      } else {
        const orig = new Map(loadAll(origMem).map((r) => [r.id, fingerprint(r)]))
        const back = new Map(rows.map((r) => [r.id, fingerprint(r)]))
        const diffs = []
        for (const [id, fp] of orig) {
          const b = back.get(id)
          if (!b) { diffs.push({ id, field: '整条缺失' }); continue }
          for (const k of Object.keys(fp)) if (fp[k] !== b[k]) diffs.push({ id, field: k })
        }
        for (const id of back.keys()) if (!orig.has(id)) diffs.push({ id, field: '原数据里没有（备份之后被删？）' })
        const d0 = drawer(origMem), d1 = drawer(restored)
        if (d0.open !== d1.open || d0.spoken !== d1.spoken) diffs.push({ id: '（抽屉）', field: `开着 ${d0.open}→${d1.open}，说出口 ${d0.spoken}→${d1.spoken}` })
        report.diffs = diffs.slice(0, 50)
        check('与原数据一致', diffs.length === 0, diffs.length
          ? diffs.length + ' 处不一致（只列 id 和字段；如果备份之后她又写过东西，这里有差异是正常的）'
          : orig.size + ' 条经历的 then、后记、想起次数、未完状态、封存、联想、章节全部一致；抽屉 ' + d0.open + ' 条开着、' + d0.spoken + ' 条说出口了')
      }
    }
  } catch (e) {
    check('恢复后能读', false, String(e.message || e))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  report.ok = report.checks.every((c) => c.ok)
  report.verdict = report.checks.filter((c) => c.name !== '与原数据一致').every((c) => c.ok) ? (report.ok ? '可恢复，且与原数据一致' : '可恢复，但与原数据有差异') : '不可恢复'
  return report
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const arg = (k, d = '') => {
    const eq = process.argv.find((a) => a.startsWith('--' + k + '='))
    if (eq) return eq.slice(k.length + 3)
    const i = process.argv.indexOf('--' + k)
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d
  }
  try {
    const r = restoreCheck({ from: arg('from'), data: arg('data') })
    console.log(JSON.stringify(r, null, 2))
    // 退出码：0 可恢复且一致；1 不可恢复；2 可恢复但与原数据有差异
    process.exitCode = r.verdict === '不可恢复' ? 1 : r.ok ? 0 : 2
  } catch (e) {
    console.log(JSON.stringify({ ok: false, verdict: '不可恢复', error: String(e && e.message ? e.message : e) }, null, 2))
    process.exitCode = 1
  }
}
