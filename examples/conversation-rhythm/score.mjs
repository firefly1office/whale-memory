import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
export function scoreReviews(key, reviews) {
  const map = new Map(key.map(r => [r.id, r]))
  if (map.size !== key.length) throw Error('Duplicate key')
  const reviewers = new Set()
  const totals = Object.fromEntries(['aiLike', 'fit'].map(f => [f, { baseline: 0, rhythm: 0, tie: 0, unsure: 0, unanswered: 0 }]))
  for (const review of reviews) {
    if (typeof review.reviewerId !== 'string' || !review.reviewerId || reviewers.has(review.reviewerId)) throw Error('Missing or duplicate reviewer')
    reviewers.add(review.reviewerId)
    const ratings = new Map()
    for (const r of review.ratings) {
      if (!map.has(r.id) || ratings.has(r.id)) throw Error('Unknown or duplicate card')
      ratings.set(r.id, r)
    }
    for (const item of key) for (const field of ['aiLike', 'fit']) {
      const value = ratings.get(item.id)?.[field] ?? null
      if (![null, 'A', 'B', 'tie', 'unsure'].includes(value)) throw Error('Invalid rating')
      totals[field][value === null ? 'unanswered' : ['A', 'B'].includes(value) ? item[value] : value]++
    }
  }
  return { reviewers: reviews.length, groups: key.length, expectedRatingsPerQuestion: key.length * reviews.length, totals,
    note: 'aiLike counts votes for the MORE AI-like response; fit counts votes for the MORE appropriate response. No calibrated accuracy or population claim.' }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [keyFile, ...files] = process.argv.slice(2)
  if (!keyFile || !files.length) throw Error('Usage: node score.mjs key.json review1.json [review2.json]')
  console.log(JSON.stringify(scoreReviews(JSON.parse(fs.readFileSync(keyFile)), files.map(f => JSON.parse(fs.readFileSync(f)))), null, 2))
}
