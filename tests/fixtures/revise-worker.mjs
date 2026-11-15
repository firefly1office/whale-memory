import { reviseExperience } from '../../packages/core/lib/self-experience.js'

const dir = process.argv[2]
const n = Number(process.argv[3] || 10)
const id = process.argv[4] || 'exp_worker'

for (let i = 0; i < n; i++) {
  const res = reviseExperience(dir, { id, thought: 'worker-' + i })
  if (!res.ok) {
    console.error(JSON.stringify(res))
    process.exit(1)
  }
}