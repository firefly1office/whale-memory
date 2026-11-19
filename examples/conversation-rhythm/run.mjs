import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomInt } from 'node:crypto'
import { cases } from './cases.mjs'
import { messagesFor, inspect } from './rhythm.mjs'
import { blindStudy, htmlFor } from './blind.mjs'
const args = process.argv.slice(2)
const arg = name => args[args.indexOf(name) + 1]
if (!args.includes('--provider')) {
  console.log(JSON.stringify({ status: 'not-sampled', cases: cases.length, requests: cases.length * 2, humanRatings: null }))
} else {
  if (!args.includes('--out')) throw Error('Specify a new output directory')
  const provider = await import(pathToFileURL(path.resolve(arg('--provider'))).href)
  if (typeof provider.generate !== 'function') throw Error('Provider must export generate')
  const dir = path.resolve(arg('--out'))
  fs.mkdirSync(dir) // Refuse an existing directory, never overwrite a study.
  const report = { version: 1, corpus: 'fictional-development', model: provider.metadata || null,
    corpusHash: createHash('sha256').update(JSON.stringify(cases)).digest('hex'), plannedRequests: cases.length * 2,
    humanRatings: null, results: [] }
  const save = () => fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
  save()
  const first = randomInt(2)
  for (const [i, item] of cases.entries()) {
    for (const arm of (i + first) % 2 ? ['baseline', 'rhythm'] : ['rhythm', 'baseline']) {
      const messages = messagesFor(item, arm)
      const row = { id: item.id, arm, messages, requestHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex') }
      const controller = new AbortController()
      let timer
      try {
        row.raw = await Promise.race([provider.generate(messages, { signal: controller.signal }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Timeout')) }, 30000) })])
        row.output = inspect(row.raw)
        row.delivery = arm === 'rhythm' && row.output.violations.length ? 'blocked-style' : 'eligible'
        row.status = 'generated'
      } catch (e) { row.status = 'error'; row.error = e.message }
      finally { clearTimeout(timer); if (provider.lastResponse) row.provider = structuredClone(provider.lastResponse) }
      report.results.push(row); save()
      console.log(item.id, arm, row.status, row.delivery || '')
    }
  }
  const study = blindStudy(cases, report.results)
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(study.key, null, 2))
  fs.writeFileSync(path.join(dir, 'blind.html'), htmlFor(study.cards))
  report.summary = Object.fromEntries(['baseline', 'rhythm'].map(arm => {
    const rows = report.results.filter(r => r.arm === arm), valid = rows.filter(r => r.output)
    return [arm, { attempted: rows.length, errors: rows.length - valid.length,
      surfaceConstraintsPassed: valid.filter(r => !r.output.violations.length).length,
      silent: valid.filter(r => r.output.action === 'silent').length,
      averageChars: valid.length ? valid.reduce((n, r) => n + r.output.chars, 0) / valid.length : null }]
  }))
  save()
  console.log(JSON.stringify(report.summary))
}
