import { phrase } from './context.js'

const KINDS = ['ordinary', 'playful', 'affection', 'support', 'disclosure', 'hurt', 'boundary', 'quotation', 'mixed', 'uncertain']
export const EFFECTS = Object.freeze({
  none: [0, 0, 0], care: [0.01, 0.015, 0], kept_promise: [0.02, 0.01, 0],
  repair: [0.01, 0.01, -0.02], boundary_violation: [-0.02, -0.01, 0.03], betrayal: [-0.04, -0.02, 0.04]
})
const oneOf = (value, allowed) => {
  if (!allowed.includes(value)) throw Error('Invalid appraisal category')
  return value
}
const list = (value, limit) => {
  if (!Array.isArray(value) || value.length > limit) throw Error('Invalid appraisal list')
  return value
}
const number = (n, min, max) => {
  if (!Number.isFinite(n) || n < min || n > max) throw Error('Invalid appraisal number')
  return n
}

export function validateAppraisal(raw, sources) {
  const sourceMap = new Map(sources.map(s => [s.id, s]))
  function evidence(items, requireCurrent = true) {
    const result = list(items, 6).map(item => {
      const source = phrase(item?.source, 120)
      const quote = phrase(item?.quote, 400)
      if (!sourceMap.get(source)?.text.includes(quote)) throw Error('Unsupported evidence quote')
      return { source, quote }
    })
    if (requireCurrent && !result.some(b => b.source === 'current')) throw Error('Missing current evidence')
    return result
  }
  const interpretations = list(raw?.interpretations, 3).map(p => ({
    kind: oneOf(p.kind, KINDS), certainty: oneOf(p.certainty, ['low', 'medium', 'high']),
    meaning: phrase(p.meaning), emotions: list(p.emotions, 4).map(e => phrase(e, 40)), basis: evidence(p.basis)
  }))
  const selected = raw.selected
  if (selected !== null && (!Number.isInteger(selected) || !interpretations[selected])) throw Error('Invalid selected interpretation')
  const selfFeelings = list(raw.selfFeelings, 3).map(f => {
    const basis = evidence(f.basis)
    if (!basis.some(b => ['concern', 'relationship', 'boundary'].includes(sourceMap.get(b.source)?.kind))) throw Error('Missing personal concern evidence')
    return { name: phrase(f.name, 40), valence: number(f.valence, -1, 1), intensity: number(f.intensity, 0, 1), meaning: phrase(f.meaning), basis }
  })
  const kind = oneOf(raw.relationship?.kind, Object.keys(EFFECTS))
  const relationship = { kind, target: oneOf(raw.relationship.target, ['person', 'other', 'unclear']), basis: evidence(raw.relationship.basis, kind !== 'none') }
  if (kind === 'boundary_violation' && !relationship.basis.some(b => sourceMap.get(b.source)?.kind === 'boundary')) throw Error('Missing known boundary evidence')
  // Strip obsolete responseHint from historical/provider payloads; never return or persist it.
  return { interpretations, selected, selfFeelings, relationship }
}

// Shared by new-event settlement and clarification admission. Call with validated data.
export function admits(appraisal, { policy = 'legacy-high', sources = [] } = {}) {
  if (!['legacy-high', 'boundary-v2'].includes(policy)) throw Error('Unknown settlement policy')
  const selected = appraisal.interpretations[appraisal.selected]
  const confident = selected?.certainty === 'high' && selected.kind !== 'uncertain'
  const relation = appraisal.relationship
  // This concerns an observed boundary crossing, not intent. Mixed/uncertain readings
  // do not qualify for the medium exception. Evidence must already be validated.
  const observedBoundary = policy === 'boundary-v2' && relation.kind === 'boundary_violation'
    && relation.target === 'person'
    && selected?.certainty === 'medium' && ['boundary', 'hurt'].includes(selected.kind)
    && relation.basis.some(b => b.source === 'current' && sources.some(s => s.id === b.source && s.text.includes(b.quote)))
    && relation.basis.some(b => sources.some(s => s.id === b.source && s.kind === 'boundary' && s.text.includes(b.quote)))
  return confident || observedBoundary
}

// The model proposes meaning. This gate controls state changes, not semantic truth.
export function settle(appraisal, options = {}) {
  const admitted = admits(appraisal, options)
  const selected = appraisal.interpretations[appraisal.selected]
  const relation = appraisal.relationship
  const allowed = {
    care: ['support', 'affection', 'mixed'], kept_promise: ['support', 'mixed'],
    repair: ['support', 'mixed'], boundary_violation: ['hurt', 'boundary', 'mixed'], betrayal: ['hurt', 'boundary', 'mixed']
  }
  const applyRelation = admitted && relation.target === 'person' && allowed[relation.kind]?.includes(selected.kind)
  const relationshipKind = applyRelation ? relation.kind : 'none'
  const selfFeelings = selected && selected.certainty !== 'low' && !['quotation', 'uncertain'].includes(selected.kind) ? appraisal.selfFeelings : []
  return {
    selfFeelings,
    relationshipKind,
    relationshipDelta: [...EFFECTS[relationshipKind]],
    reason: applyRelation ? (selected.certainty === 'medium' ? 'observed-boundary-medium' : 'supported-event') : 'no-supported-relationship-change'
  }
}
