import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withFileLock } from '../core/lib/file-lock.js'
import { prepareContext, buildMessages, phrase, timestamp } from './context.js'
import { validateAppraisal, settle, admits } from './appraisal.js'
export { prepareContext, buildMessages } from './context.js'
export { validateAppraisal, settle, admits } from './appraisal.js'

const FILE = 'emotion-events.jsonl'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const scopeKey = c => JSON.stringify([c.characterId, c.scope, c.personId])
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const round = x => Number(x.toFixed(6))

function readEvents(dir) {
  let text
  try { text = fs.readFileSync(path.join(dir, FILE), 'utf8') }
  catch (e) { if (e.code === 'ENOENT') return []; throw e }
  const rows = []
  const ids = new Map()
  for (const line of text.split('\n').filter(s => s.trim())) {
    const r = JSON.parse(line) // Never silently skip a damaged correction.
    if (r.version !== 1 || ids.has(r.id)) throw Error('Invalid emotion journal')
    phrase(r.id, 100); timestamp(r.at)
    for (const field of ['characterId', 'scope', 'personId']) phrase(r.context?.[field], 100)
    if (r.context.turn?.at !== r.at || hash(r.context) !== r.inputHash) throw Error('Invalid emotion context')
    validateAppraisal(r.appraisal, r.context.sources)
    const previous = r.supersedes ? ids.get(r.supersedes) : null
    if (r.supersedes && (!previous || scopeKey(previous.context) !== scopeKey(r.context) || previous.rootId !== r.rootId || r.at < previous.at)) throw Error('Invalid correction chain')
    if (!r.supersedes && r.rootId !== r.id) throw Error('Invalid event root')
    rows.push(r); ids.set(r.id, r)
  }
  activeRows(rows)
  return rows
}

function activeRows(rows) {
  const roots = new Map()
  for (const row of rows) {
    if (row.supersedes && roots.get(row.rootId)?.id !== row.supersedes) throw Error('Correction does not replace active version')
    roots.set(row.rootId, row)
  }
  return [...roots.values()] // Map preserves original event order for replay.
}

export function projectEmotion(dir, scope, { now = Date.now(), baseline = { trust: 0.5, closeness: 0.5, tension: 0 }, halfLifeMs = 7200000 } = {}) {
  timestamp(now)
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) throw Error('Invalid half life')
  for (const field of ['characterId', 'scope', 'personId']) phrase(scope[field], 100)
  const relationship = {}
  for (const key of ['trust', 'closeness', 'tension']) {
    if (!Number.isFinite(baseline[key]) || baseline[key] < 0 || baseline[key] > 1) throw Error('Invalid baseline')
    relationship[key] = baseline[key]
  }
  const rows = readEvents(dir).filter(r => scopeKey(r.context) === scopeKey(scope) && r.at <= now)
  const feelings = []
  for (const row of activeRows(rows)) {
    const applied = settle(row.appraisal, { policy: row.settlementPolicy || 'legacy-high', sources: row.context.sources })
    Object.keys(relationship).forEach((key, i) => { relationship[key] = round(clamp(relationship[key] + applied.relationshipDelta[i], 0, 1)) })
    for (const f of applied.selfFeelings) {
      const intensity = f.intensity * 2 ** (-(now - row.at) / halfLifeMs)
      if (intensity >= 0.01) feelings.push({ ...f, intensity: round(intensity), eventId: row.id, at: row.at })
    }
  }
  return { relationship, feelings, mood: round(clamp(feelings.reduce((n, f) => n + f.valence * f.intensity * 0.25, 0), -1, 1)), events: rows.length }
}

// No files or model calls when disabled. Host callback owns provider configuration.
export async function evaluateEmotion({ enabled = false, dir, input, generate, supersedes = null, timeoutMs = 30000, signal } = {}) {
  if (enabled !== true) return { status: 'off' }
  if (typeof generate !== 'function') throw Error('A model generate callback is required')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw Error('Invalid timeout')
  const context = prepareContext(input)
  const key = scopeKey(context)
  const before = readEvents(dir).filter(r => scopeKey(r.context) === key)
  const inputHash = hash(context)
  const duplicate = before.find(r => r.context.turn.id === context.turn.id)
  if (duplicate) {
    if (duplicate.inputHash !== inputHash || duplicate.supersedes !== supersedes) throw Error('Turn id reused with different input')
    return { status: 'duplicate', eventId: duplicate.id }
  }
  if (before.some(r => r.at > context.turn.at)) throw Error('Out-of-order turn; use a later clarification')
  const previous = supersedes ? activeRows(before).find(r => r.id === supersedes) : null
  if (supersedes && !previous) throw Error('Correction must name an active event in the same scope')
  const messages = buildMessages(context)
  if (previous) messages[1].content = JSON.stringify({
    ...context,
    correction: { eventId: previous.id, originalText: previous.context.turn.text, originalAppraisal: validateAppraisal(previous.appraisal, previous.context.sources),
      instruction: '本轮澄清用于重新评价这件旧事；不要把澄清当作另一件加减好感的事。旧判断仅供识别误会，不是事实证据。证据仍只能引用当前 sources。' }
  })
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  let timer
  let raw
  try {
    raw = await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return generate(messages, { signal: controller.signal })
      }),
      new Promise((_, reject) => {
        const abort = () => reject(Error('Emotion evaluation aborted'))
        controller.signal.addEventListener('abort', abort, { once: true })
        if (controller.signal.aborted) abort()
        timer = setTimeout(() => controller.abort(), timeoutMs)
      })
    ])
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
  if (raw === null || raw?.skip === true) return { status: 'skipped' }
  const appraisal = validateAppraisal(raw, context.sources)
  controller.signal.throwIfAborted()
  const settlement = { policy: 'boundary-v2', sources: context.sources }
  const applied = settle(appraisal, settlement)
  if (previous) {
    if (!admits(appraisal, settlement)) return { status: 'unresolved', appraisal }
    if (appraisal.interpretations[appraisal.selected].certainty !== 'high') {
      const old = settle(previous.appraisal, { policy: previous.settlementPolicy || 'legacy-high', sources: previous.context.sources })
      const [trust, closeness, tension] = applied.relationshipDelta
      const [oldTrust, oldCloseness, oldTension] = old.relationshipDelta
      // Medium can add/confirm a boundary, never undo or soften prior harm.
      if (trust > oldTrust || closeness > oldCloseness || tension < oldTension) return { status: 'unresolved', appraisal }
    }
  }
  const proposed = { version: 1, settlementPolicy: 'boundary-v2', id: randomUUID(), at: context.turn.at, rootId: null, supersedes, inputHash, context, appraisal }
  proposed.rootId = previous?.rootId || proposed.id
  fs.mkdirSync(dir, { recursive: true })
  return withFileLock(path.join(dir, FILE + '.lock'), () => {
    const current = readEvents(dir).filter(r => scopeKey(r.context) === key)
    if (hash(current) !== hash(before)) return { status: 'stale' }
    // Re-read is done under lock. Append a newline even after an interrupted final newline.
    const file = path.join(dir, FILE)
    let prefix = ''
    try { if (!fs.readFileSync(file, 'utf8').endsWith('\n')) prefix = '\n' } catch (e) { if (e.code !== 'ENOENT') throw e }
    fs.appendFileSync(file, prefix + JSON.stringify(proposed) + '\n', 'utf8')
    return { status: 'recorded', eventId: proposed.id, appraisal, applied }
  })
}
