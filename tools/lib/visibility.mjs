// 可见性规则的最小参考实现：只用来验证“跨会话该不该看见”，不是完整引擎
// 规则：同会话永远可见；跨会话只有「她自己的记录(self)」和「主人(personIds 里列出的)」能过，
//      而且必须由调用方显式打开 allowCrossChat

export function isVisible(record, { chatKey, personIds = [], allowCrossChat = false } = {}) {
  if (!record) return false
  if (String(record.chatKey || '') === String(chatKey || '')) return true
  if (!allowCrossChat) return false
  const pid = String(record.personId || '')
  if (pid === 'self') return true
  return personIds.map(String).includes(pid)
}

export function search(records, query, opts = {}) {
  const q = String(query || '')
  return (records || [])
    .filter((r) => isVisible(r, opts))
    .filter((r) => !q || JSON.stringify(r).includes(q))
    .slice(0, opts.limit || 10)
}