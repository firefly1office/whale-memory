#!/usr/bin/env node
// 仓库里直接跑 MCP 适配器用的入口；实现在 packages/core/bin/whale-memory-mcp.mjs（npm 包里也带着它）
//   node adapters/mcp/whale-memory-mcp.mjs --data <数据根目录> [--owner true] [--readonly true]
import { parseArgs, serve } from '../../packages/core/bin/whale-memory-mcp.mjs'

const cfg = parseArgs(process.argv.slice(2))
process.stderr.write('whale-memory-mcp：数据 ' + cfg.data + (cfg.owner ? '，抽屉已打开' : '') + (cfg.readonly ? '，只读' : '') + '\n')
serve(cfg)
