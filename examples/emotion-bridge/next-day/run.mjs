// Uses synthetic fixtures only. No arguments runs a local preflight.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { reflectOnExperience } from '../appraisal.mjs'
import { requestCompletion } from '../deepseek.mjs'

const args = process.argv.slice(2)
const sampling = args.length === 2 && args[0] === '--sample'
if (args.length && !sampling) throw Error('Usage: node run.mjs [--sample NEW_FILE]')
if (sampling && !process.env.DEEPSEEK_API_KEY) throw Error('DEEPSEEK_API_KEY is required')
const output = args[1]
const read = name => fs.readFileSync(new URL(name, import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const cases = JSON.parse(read('cases.json'))
const settings = { model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', temperature: 0.4, max_tokens: 8192, response_format: { type: 'json_object' } }
const conditions = ['yesterday', 'a', 'b', 'control']
const day1 = '2025-10-11', day2 = '2025-10-12'
const thenFile = 'self-experience.jsonl', laterFile = 'later-events.jsonl'
const mock = { perspectives: [], agency: { value: 'unknown', basis: [] }, control: { value: 'unknown', basis: [] }, nowEffects: [],
  tradeoff: { kind: 'none', kept: null, sacrificed: null }, now: null }
const report = {
  startedAt: new Date().toISOString(), settings,
  files: Object.fromEntries(['cases.json', 'README.md', 'run.mjs', '../appraisal.mjs', '../deepseek.mjs'].map(n => [n, hash(read(n))])),
  requests: [], results: []
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-next-day-'))

function prepare(item, condition) {
  const dir = fs.mkdtempSync(path.join(root, 'case-'))
  const event = { id: 'exp_fiction', author: 'self', source: 'own-time', at: day1 + 'T09:00:00Z', day: day1,
    then: { text: item.text, thought: item.thought, unfinished: item.unfinished || '', feeling: item.feeling }, later: [] }
  // The later entry is physically present even for the as-of (yesterday) test.
  const note = { id: event.id, at: day2 + 'T09:00:00Z', day: day2, thought: item[condition === 'yesterday' ? 'a' : condition] }
  fs.writeFileSync(path.join(dir, thenFile), JSON.stringify(event) + '\n')
  fs.writeFileSync(path.join(dir, laterFile), JSON.stringify(note) + '\n')
  const asOf = (condition === 'yesterday' ? day1 : day2) + 'T22:00:00Z'
  return { item, condition, options: { dir, id: event.id, asOf, enabled: true, chatKey: 'local:owner' } }
}

function inventory(dir) {
  return fs.readdirSync(dir).sort().map(name => [name, hash(fs.readFileSync(path.join(dir, name)))])
}

async function preflight(job) {
  const { item, condition, options } = job
  const past = [{ id: 'event', text: item.text }, { id: 'thought', text: item.thought }]
  if (item.unfinished) past.push({ id: 'unfinished', text: item.unfinished })
  item.feeling.forEach((text, i) => past.push({ id: 'then.feeling.' + i, text }))
  const expected = condition === 'yesterday' ? past : [...past, { id: 'later.0', text: item[condition] }]
  job.files = inventory(options.dir)
  const response = await reflectOnExperience({ ...options, generate(messages) {
    assert.deepEqual(JSON.parse(messages[1].content), expected)
    job.requestHash = hash(JSON.stringify(messages))
    return mock
  } })
  assert.equal(response.status, 'reflected')
  assert.deepEqual(response.recordedFeelings, past.filter(s => s.id.includes('.feeling.')))
  assert.deepEqual(inventory(options.dir), job.files)
  report.requests.push({ case: item.id, condition, requestHash: job.requestHash, thenHash: hash(JSON.stringify(past)) })
}

async function sample(job) {
  const result = { case: job.item.id, condition: job.condition, requestHash: job.requestHash }
  let providerFailure
  try {
    const answer = await reflectOnExperience({ ...job.options, generate: async messages => {
      assert.equal(hash(JSON.stringify(messages)), job.requestHash)
      let response
      try { response = await requestCompletion(messages, settings) }
      catch (error) { providerFailure = error; throw error }
      Object.assign(result, response)
      if (response.finishReason !== 'stop') throw Error('Incomplete output: ' + response.finishReason)
      return JSON.parse(response.text)
    } })
    result.status = answer.status
    if (answer.status === 'reflected') {
      result.appraisal = answer.appraisal
      result.flags = answer.flags
    }
  } catch (err) {
    result.status = providerFailure ? 'provider-error' : 'invalid-response'
    result.error = err.message
  }
  // A mutation is an experiment failure, even if the provider answered.
  assert.deepEqual(inventory(job.options.dir), job.files)
  report.results.push(result)
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(job.item.id, job.condition, result.status)
  if (providerFailure) throw providerFailure
}

try {
  const jobs = []
  // Rotate condition order between stories and separate repeated stories.
  for (let round = 0; round < conditions.length; round++) {
    for (const [i, item] of cases.entries()) jobs.push(prepare(item, conditions[(i + round) % conditions.length]))
  }
  for (const job of jobs) await preflight(job)
  for (const item of cases) {
    const requests = report.requests.filter(r => r.case === item.id)
    assert.equal(requests.length, 4)
    assert.equal(new Set(requests.map(r => r.thenHash)).size, 1)
    assert.equal(new Set(requests.map(r => r.requestHash)).size, 4)
  }
  console.log('Preflight passed for', jobs.length, 'requests')
  if (sampling) {
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' })
    for (let i = 0; i < jobs.length; i += 3) {
      const batch = await Promise.allSettled(jobs.slice(i, i + 3).map(sample))
      const failure = batch.find(r => r.status === 'rejected')
      if (failure) throw failure.reason
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
