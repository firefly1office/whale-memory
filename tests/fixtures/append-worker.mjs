import { append } from '../../packages/core/lib/recall-events.js'

const dataDir = process.argv[2]
const n = Number(process.argv[3] || 10)
const id = process.argv[4] || 'exp_worker'

for (let i = 0; i < n; i++) {
  append(dataDir, { id, query: 'worker-' + i }, { timeoutMs: 15000 })
}