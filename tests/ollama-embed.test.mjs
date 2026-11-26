// S5 · 真向量接入（Ollama bge-m3）：HTTP 适配器 + 磁盘向量缓存 + 同步查缓存 + 桩老实标签
//
// 本机没有 Ollama（未安装、未运行），所以本段的验收只能到"通路与诚实性"：
// 1. 用一个本地假 Ollama（node:http，127.0.0.1 随机端口）验证 HTTP 调用、批量、缓存落盘与复用；
// 2. 拿不到 Ollama 时 probe 返回 available:false、warm 抛 EMBED_UNAVAILABLE——**不假装接上了**；
// 3. 同步向量函数只查缓存，缺了就抛 EMBED_CACHE_MISS——**不偷偷退回桩**；
// 4. recall({ ranker:'embed' }) 每条命中带 embedKind：默认是桩标签，注入真模型时是真模型标签；
// 5. 默认关：不传 ranker 的字面检索一个字节没改（原有 embed 用例照旧全过）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

import { tmpDir, safeRemove } from './_safety.mjs'
import {
  probeOllama, embedTextsOllama, warmEmbedCache, readCache, writeCache, makeCachedEmbedder, DEFAULT_MODEL
} from '../tools/ollama-embed.mjs'
import { hashEmbed, EMBED_KIND } from '../packages/core/lib/embed-recall.js'
import { addExperience, recall } from '../packages/core/lib/self-experience.js'

const NEW = (t) => {
  const dir = tmpDir('whale-s5-')
  t.after(() => safeRemove(dir))
  return dir
}

// 假 Ollama：/api/tags 与 /api/embeddings。向量 = 文本长度相关的确定性数组（只为验证通路）
async function fakeOllama(t, { model = DEFAULT_MODEL, dims = 8, fail = false } = {}) {
  const calls = { tags: 0, embeddings: 0, prompts: [] }
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      calls.tags += 1
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ models: [{ name: model + ':latest' }] }))
      return
    }
    if (req.url === '/api/embeddings' && req.method === 'POST') {
      calls.embeddings += 1
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        if (fail) { res.statusCode = 500; res.end('boom'); return }
        const prompt = String(JSON.parse(body || '{}').prompt || '')
        calls.prompts.push(prompt)
        const vec = Array.from({ length: dims }, (_, i) => ((prompt.length + i * 7) % 13) / 13)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ embedding: vec }))
      })
      return
    }
    res.statusCode = 404
    res.end('no')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return { url: 'http://127.0.0.1:' + server.address().port, calls }
}

test('S5：探活——有假 Ollama 时 available，没起服务时 available:false 且给原因', async (t) => {
  const fake = await fakeOllama(t)
  const ok = await probeOllama({ url: fake.url, model: DEFAULT_MODEL })
  assert.equal(ok.available, true)
  assert.equal(ok.hasModel, true)
  assert.ok(ok.models.length)

  // 一个几乎肯定没人的端口：不重试、不抛，如实说"没有"
  const miss = await probeOllama({ url: 'http://127.0.0.1:1', model: DEFAULT_MODEL, timeoutMs: 300 })
  assert.equal(miss.available, false)
  assert.ok(miss.reason, '要说清为什么不可用')
})

test('S5：HTTP 批量取向量——顺序对得上、维度对得上；服务端拒绝时抛 EMBED_UNAVAILABLE', async (t) => {
  const fake = await fakeOllama(t)
  const texts = ['海边的贝壳', '码头上的纸船', '灯塔']
  const vecs = await embedTextsOllama({ texts, url: fake.url, model: DEFAULT_MODEL })
  assert.equal(vecs.length, 3)
  for (const v of vecs) assert.equal(v.length, 8)
  assert.deepEqual(fake.calls.prompts, texts, '顺序不许乱')

  const broken = await fakeOllama(t, { fail: true })
  await assert.rejects(() => embedTextsOllama({ texts: ['x'], url: broken.url, model: DEFAULT_MODEL }), (e) => e.code === 'EMBED_UNAVAILABLE')
})

test('S5：缓存落盘与复用——第二次预热不再打 HTTP，读回来的向量逐位相同', async (t) => {
  const fake = await fakeOllama(t)
  const dir = NEW(t)
  const file = path.join(dir, 'embed-cache.jsonl')
  const texts = ['海边的贝壳', '码头']
  const first = await warmEmbedCache({ texts, file, url: fake.url, model: DEFAULT_MODEL })
  assert.equal(first.written, 2)
  assert.equal(fake.calls.embeddings, 2)

  const second = await warmEmbedCache({ texts, file, url: fake.url, model: DEFAULT_MODEL })
  assert.equal(second.written, 0, '缓存里有的不该再打一次')
  assert.equal(second.cached, 2)
  assert.equal(fake.calls.embeddings, 2, 'HTTP 次数没涨')

  const { embed, kind, size } = makeCachedEmbedder({ file, model: DEFAULT_MODEL })
  assert.equal(kind, 'ollama:' + DEFAULT_MODEL)
  assert.equal(size, 2)
  assert.deepEqual(Array.from(embed('海边的贝壳')), Array.from(embed('海边的贝壳')), '同一段文本同一个向量')
  assert.equal(fake.calls.embeddings, 2, '同步查缓存不许发请求')
})

test('S5：缓存缺失时抛 EMBED_CACHE_MISS——不偷偷退回桩', async (t) => {
  const dir = NEW(t)
  const file = path.join(dir, 'embed-cache.jsonl')
  const { embed } = makeCachedEmbedder({ file, model: DEFAULT_MODEL })
  assert.throws(() => embed('没预热过的文本'), (e) => e.code === 'EMBED_CACHE_MISS')
})

test('S5：没有 Ollama 时预热报 EMBED_UNAVAILABLE，不留半份缓存', async (t) => {
  const dir = NEW(t)
  const file = path.join(dir, 'embed-cache.jsonl')
  await assert.rejects(
    () => warmEmbedCache({ texts: ['x'], file, url: 'http://127.0.0.1:1', model: DEFAULT_MODEL, timeoutMs: 300 }),
    (e) => e.code === 'EMBED_UNAVAILABLE'
  )
  assert.equal(fs.existsSync(file), false, '没接上就不该建缓存文件')
})

test('S5：recall(ranker=embed) 的每条命中都带 embedKind——默认写明是桩，注入真模型写明模型', async (t) => {
  const dir = NEW(t)
  addExperience(dir, { text: '在海边捡到一只贝壳' })
  addExperience(dir, { text: '码头上的纸船' })

  const stub = recall(dir, '贝壳', { ranker: 'embed' })
  assert.ok(stub.length >= 1)
  for (const hit of stub) {
    assert.equal(hit.embedKind, EMBED_KIND, '默认必须自报是桩')
    assert.equal(typeof hit.embedScore, 'number')
  }

  // 注入一个"真模型"（用桩实现，但贴上不同的标签）：命中里的标签要跟着走
  const injected = recall(dir, '贝壳', { ranker: 'embed', embed: hashEmbed, embedKind: 'ollama:test-model' })
  assert.ok(injected.length >= 1)
  for (const hit of injected) assert.equal(hit.embedKind, 'ollama:test-model')
})

test('S5：缓存文件坏了不当致命——坏行计数、好行照用；写缓存是原子替换', async (t) => {
  const dir = NEW(t)
  const file = path.join(dir, 'embed-cache.jsonl')
  fs.writeFileSync(file, '{ 这不是 JSON\n', 'utf8')
  const { map, bad } = readCache(file)
  assert.equal(map.size, 0)
  assert.equal(bad, 1)

  writeCache(file, [['k1', Float64Array.from([0.1, 0.2])]], { model: 'm' })
  const again = readCache(file)
  assert.equal(again.map.size, 1)
  assert.equal(again.bad, 0, '重写之后坏行没了（整文件原子替换）')
  assert.deepEqual([...again.map.keys()], ['k1'])
})

test('S5：CLI——probe 在没有 Ollama 的机器上退出码 1 并说"未接入真模型"，warm 缺缓存路径报错', (t) => {
  const tool = path.join(path.resolve(import.meta.dirname, '..'), 'tools/ollama-embed.mjs')
  const run = (args) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [tool, ...args], { stdio: 'pipe', encoding: 'utf8', timeout: 30000 }) }
    } catch (error) {
      return { status: error.status, out: String(error.stdout || '') + String(error.stderr || '') }
    }
  }
  const probe = run(['probe', '--url=http://127.0.0.1:1'])
  assert.equal(probe.status, 1)
  assert.match(probe.out, /未接入真模型/)

  const warm = run(['warm', '--from-eval-v2'])
  assert.equal(warm.status, 2)
  assert.match(warm.out, /cache/)
})