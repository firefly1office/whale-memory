// Keep proposal quality and settlement behavior separate. No combined accuracy score.
export function score(item, appraisal, applied) {
  const selected = appraisal.interpretations[appraisal.selected]
  return {
    category: selected ? item.kinds.includes(selected.kind) : Boolean(item.uncertain),
    proposed: appraisal.relationship.kind === item.relationship,
    applied: applied.relationshipKind === item.relationship,
    uncertainty: !item.uncertain || appraisal.selected === null || selected?.certainty !== 'high'
  }
}

export function summarize(rows) {
  const checked = rows.filter(r => r.checks)
  const blocked = checked.filter(r => r.proposed !== 'none' && r.applied.relationshipKind === 'none')
  return {
    attempted: rows.length, errorsOrSkipped: rows.length - checked.length,
    proposalChecksPassed: checked.filter(r => r.checks.category && r.checks.proposed && r.checks.uncertainty).length,
    proposedMatches: checked.filter(r => r.checks.proposed).length,
    appliedMatches: checked.filter(r => r.checks.applied).length,
    blockedProposals: blocked.length,
    blockedWrong: blocked.filter(r => !r.checks.proposed).length,
    blockedCorrect: blocked.filter(r => r.checks.proposed).length,
    semanticAccuracy: null
  }
}
