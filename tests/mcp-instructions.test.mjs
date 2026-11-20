// MCP initialize 的 instructions：至少要包含「查空不编」和「别顺着前提补细节」。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from '../packages/core/bin/whale-memory-mcp.mjs'

const cfg = { data: 'unused', owner: false, readonly: true }

test('initialize 返回 instructions，且包含前提纠正规则', () => {
  const handle = createServer(cfg)
  const res = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  const text = res.result.instructions
  assert.ok(typeof text === 'string' && text.length > 50)
  assert.ok(text.includes('do not make anything up'))
  assert.ok(text.includes('premise'))
  assert.ok(text.includes('没有记录'))
})

test('tools/list 里 recall 的描述写明空结果不代表同意', () => {
  const handle = createServer(cfg)
  const res = handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const recall = res.result.tools.find((x) => x.name === 'memory_recall')
  assert.ok(recall.description.includes('none means none'))
})
