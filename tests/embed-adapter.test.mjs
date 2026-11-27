// N1 · 真向量适配器：probe 带维度、embed 内容哈希缓存、维度/归一化校验 fail closed、评测两条路都跑得动。
//
// 本机**没有 Ollama**（未安装、未运行），所以这一层只能拿本地假模型（node:http，127.0.0.1 随机端口）验：
// 1. probe()：可用时 {available, model, dim}（dim 是真问出来的一条向量长度）；不可用/没模型/接口报错一律
//    {available:false, dim:null, reason}——不抛错、不编维度；
// 2. embed()：内容哈希缓存（同文本只请求一次，磁盘已有的不请求）；第二次调用零 HTTP；
// 3. fail closed：维度对不上（单条或同批长短不一）、NaN/Infinity、零向量 → 抛错且**一个字节都不写缓存**；
// 4. 归一化：非单位向量进来，出去是单位长度（cosine 口径一致）；
// 5. eval-v2：桩 / 真模型 / 真模型不可用 三条路都跑得动，报告里能一眼看出是哪种；
// 6. 默认关：不传 embed 就是桩（原有用例照旧全过）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync, execFile } from 'node:child_process'

import { tmpDir, safeRemove } from './_safety.mjs'
import {
  probe, probeOllama, embed, embedTextsOllama, warmEmbedCache, readCache, writeCache,
  makeCachedEmbedder, normalizeVector, DEFAULT_MODEL, PROBE_TEXT
} from '../tools/ollama-embed.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const NEW = (t) => {
  const dir = tmpDir('whale-n1-embed-')
  t.after(() => safeRemove(dir))
  return dir
}

// 假模型：确定性向量（维度可断言），可选失败 / 换维度 / 自定义向量函数
async function fakeModel(t, { dims = 8, model = DEFAULT_MODEL, fail = false, hasModel = true, vectorize = null } = {}) {
  const calls = { tags: 0, embeddings: 0, prompts: [] }
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      calls.tags += 1
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ models: hasModel ? [{ name: model + ':latest' }] : [{ name: 'llama3:latest' }] }))
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
        const vec = vectorize ? vectorize(prompt) : Array.from({ length: dims }, (_, i) => (((prompt.length * 7 + i * 13) % 31) / 31) - 0.5)
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

const cliRun = (args, { timeout = 60000 } = {}) => {
  try {
    return { status: 0, out: execFileSync(process.execPath, [path.join(ROOT, 'tools/ollama-embed.mjs'), ...args], { stdio: 'pipe', encoding: 'utf8', timeout }) }
  } catch (error) {
    return { status: error.status, out: String(error.stdout || '') + String(error.stderr || '') }
  }
}

// 同步的 execFileSync / spawnSync 会**卡住父进程的事件循环**——假模型服务就在父进程里，那就谁也回不了话。
// 所以凡是要连假服务的，都用异步版。
const runAsync = (tool, args, { timeout = 180000 } = {}) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(ROOT, 'tools', tool), ...args], { timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    const status = error ? (typeof error.code === 'number' ? error.code : 1) : 0
    resolve({ status, stdout: String(stdout || ''), stderr: String(stderr || '') })
  })
})
const cliRunAsync = (args) => runAsync('ollama-embed.mjs', args)
const evalRun = (args) => runAsync('eval-v2.mjs', args)

test('N1：probe 明确给维度——可用时 {available,model,dim}，拿不到就是 false + dim:null，不抛错', async (t) => {
  const fake = await fakeModel(t, { dims: 8 })
  const ok = await probe({ url: fake.url, model: DEFAULT_MODEL })
  assert.equal(ok.available, true)
  assert.equal(ok.model, DEFAULT_MODEL)
  assert.equal(ok.dim, 8, 'dim 要真量出来')
  assert.equal(ok.hasModel, true)
  assert.equal(fake.calls.embeddings, 1, '量维度就是拿一句固定文本要一条向量')
  assert.equal(fake.calls.prompts[0], PROBE_TEXT)

  // 端口 1：不重试、不抛、不编维度
  const miss = await probe({ url: 'http://127.0.0.1:1', model: DEFAULT_MODEL, timeoutMs: 300 })
  assert.equal(miss.available, false)
  assert.equal(miss.dim, null)
  assert.ok(miss.reason, '要说清为什么不可用')

  // 模型没 pull
  const noModel = await fakeModel(t, { hasModel: false })
  const missing = await probe({ url: noModel.url, model: DEFAULT_MODEL })
  assert.equal(missing.available, false)
  assert.equal(missing.dim, null)
  assert.match(missing.reason, /pull|model/i)

  // 接口 500：不崩，如实说
  const broken = await fakeModel(t, { fail: true })
  const failed = await probe({ url: broken.url, model: DEFAULT_MODEL })
  assert.equal(failed.available, false)
  assert.equal(failed.dim, null)
  assert.match(failed.reason, /UNAVAILABLE|500/)
})

test('N1：embed 内容哈希缓存——同文本不重复请求，第二次全走缓存、维度与顺序都对', async (t) => {
  const fake = await fakeModel(t, { dims: 8 })
  const dir = NEW(t)
  const file = path.join(dir, 'embed-cache.jsonl')
  const texts = ['海边的贝壳', '海边的贝壳', '码头上的纸船']

  const first = await embed(texts, { file, url: fake.url, model: DEFAULT_MODEL })
  assert.equal(fake.calls.embeddings, 2, '重复的那条只请求一次（内容哈希去重）')
  assert.equal(first.hits, 0, '这一次全是新文本，没有缓存命中')
  assert.equal(first.misses, 2, '去重后要请求两条')
  assert.equal(first.added, 2)
  assert.equal(first.dim, 8)
  assert.equal(first.vectors.length, 3)
  for (const vec of first.vectors) assert.equal(vec.length, 8)
  assert.deepEqual(Array.from(first.vectors[0]), Array.from(first.vectors[1]), '同一段文本同一个向量')
  assert.equal(readCache(file).map.size, 2)

  const second = await embed(texts, { file, url: fake.url, model: DEFAULT_MODEL })
  assert.equal(fake.calls.embeddings, 2, '缓存里有的不该再打一次 HTTP')
  assert.equal(second.hits, 3)
  assert.equal(second.misses, 0)
  assert.equal(second.added, 0)
  // 缓存按 6 位小数落盘（显式约定），所以按 6 位比；同一段文本两次拿到的向量不许有实质差别
  assert.deepEqual(Array.from(second.vectors[0]).map((v) => v.toFixed(6)), Array.from(first.vectors[0]).map((v) => v.toFixed(6)), '读回来的向量逐位相同')

  // 同步查缓存：同一套缓存、维度自洽才让用
  const cached = makeCachedEmbedder({ file, model: DEFAULT_MODEL })
  assert.equal(cached.dim, 8)
  assert.equal(cached.size, 2)
  assert.equal(cached.kind, 'ollama:' + DEFAULT_MODEL)
  assert.equal(cached.missing('没预热过的文本'), true)
  assert.throws(() => cached.embed('没预热过的文本'), (e) => e.code === 'EMBED_CACHE_MISS')
})

test('N1：维度不符 fail closed——报 EMBED_DIM_MISMATCH，缓存一个字节都不动', async (t) => {
  const dir = NEW(t)
  const file = path.join(dir, 'embed-cache.jsonl')
  const eight = await fakeModel(t, { dims: 8 })
  await embed(['A'], { file, url: eight.url, model: DEFAULT_MODEL })
  const before = fs.readFileSync(file, 'utf8')

  // 换了一个只回 5 维的服务：给了期望 dim=8 就必须红
  const five = await fakeModel(t, { dims: 5 })
  await assert.rejects(
    () => embed(['B'], { file, url: five.url, model: DEFAULT_MODEL, dim: 8 }),
    (e) => e.code === 'EMBED_DIM_MISMATCH' && e.expected === 8 && e.got === 5
  )
  assert.equal(fs.readFileSync(file, 'utf8'), before, '失败时缓存不许被改写')

  // 同一批里长短不一：没给 dim 也要红（第一条 2 维、第二条 3 维）
  const mixed = await fakeModel(t, { vectorize: (prompt) => (prompt === 'A' ? [1, 0] : [1, 0, 0]) })
  const mixedFile = path.join(dir, 'mixed.jsonl')
  await assert.rejects(
    () => embed(['A', 'B'], { file: mixedFile, url: mixed.url, model: DEFAULT_MODEL }),
    (e) => e.code === 'EMBED_DIM_MISMATCH'
  )
  assert.equal(fs.existsSync(mixedFile), false, '一条不合格就一条都不写')

  // 缓存自身维度混了：构造阶段就红，不把错维度塞进排序
  const dirty = path.join(dir, 'dirty.jsonl')
  fs.writeFileSync(dirty, [
    JSON.stringify({ v: 1, model: DEFAULT_MODEL, key: 'k1', dim: 8, vec: [1, 0, 0, 0, 0, 0, 0, 0] }),
    JSON.stringify({ v: 1, model: DEFAULT_MODEL, key: 'k2', dim: 5, vec: [1, 0, 0, 0, 0] })
  ].join('\n') + '\n', 'utf8')
  assert.throws(() => makeCachedEmbedder({ file: dirty, model: DEFAULT_MODEL }), (e) => e.code === 'EMBED_DIM_MISMATCH')
  assert.throws(() => makeCachedEmbedder({ file, model: DEFAULT_MODEL, dim: 16 }), (e) => e.code === 'EMBED_DIM_MISMATCH')
})

test('N1：归一化校验——非单位向量归一化；NaN / 零向量 fail closed 且不落盘', async (t) => {
  const dir = NEW(t)
  const fake = await fakeModel(t, { vectorize: () => [3, 4] })
  const file = path.join(dir, 'unit.jsonl')
  const out = await embed(['勾股'], { file, url: fake.url, model: DEFAULT_MODEL })
  assert.equal(out.dim, 2)
  const vec = out.vectors[0]
  const norm = Math.sqrt(Array.from(vec).reduce((s, v) => s + v * v, 0))
  assert.ok(Math.abs(norm - 1) < 1e-9, '出来必须是单位长度，实际 ' + norm)
  assert.deepEqual(Array.from(vec).map((v) => Number(v.toFixed(6))), [0.6, 0.8])
  assert.equal(makeCachedEmbedder({ file, model: DEFAULT_MODEL }).embed('勾股').length, 2)

  // JSON 里 NaN 会被写成 null，所以用字符串 "NaN" 模拟一个坏接口（客户端 Number() 之后就是 NaN）
  const nan = await fakeModel(t, { vectorize: () => [1, 'NaN'] })
  const nanFile = path.join(dir, 'nan.jsonl')
  await assert.rejects(() => embed(['坏向量'], { file: nanFile, url: nan.url, model: DEFAULT_MODEL }), (e) => e.code === 'EMBED_BAD_VECTOR')
  assert.equal(fs.existsSync(nanFile), false)

  const zero = await fakeModel(t, { vectorize: () => [0, 0] })
  const zeroFile = path.join(dir, 'zero.jsonl')
  await assert.rejects(() => embed(['零向量'], { file: zeroFile, url: zero.url, model: DEFAULT_MODEL }), (e) => e.code === 'EMBED_BAD_VECTOR')
  assert.equal(fs.existsSync(zeroFile), false)

  assert.throws(() => normalizeVector(new Float64Array([Infinity, 1])), (e) => e.code === 'EMBED_BAD_VECTOR')
})

test('N1：CLI——probe 在假模型上报 dim 并退出 0；没有 Ollama 时退出 1 且写「未接入真模型」', async (t) => {
  const fake = await fakeModel(t, { dims: 8 })
  const ok = await cliRunAsync(['probe', '--url=' + fake.url])
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /"dim": 8/)
  assert.match(ok.stdout, /可以预热真向量/)

  const miss = cliRun(['probe', '--url=http://127.0.0.1:1'])
  assert.equal(miss.status, 1)
  assert.match(miss.out, /未接入真模型/)
  assert.match(miss.out, /"dim": null/)
})

test('N1：eval-v2 三条路都跑得动——桩 / 真模型 / 真模型不可用，报告能一眼区分', async (t) => {
  // 1) 桩：不传 embed 参数
  const stub = await evalRun(['--ranker=embed', '--json', '--split=holdout'])
  assert.equal(stub.status, 0)
  const stubOut = JSON.parse(stub.stdout)
  assert.equal(stubOut.embed.connected, false)
  assert.equal(stubOut.embed.kind, 'stub:char-ngram-hash')
  assert.match(stubOut.embed.note, /未接入真模型/)
  assert.equal(typeof stubOut.rankers.embed.recall10, 'number')

  // 2) 真模型（假服务）：probe → 预热 → 用真向量跑，报告写「真向量（bge-m3，dim=8…）」
  const fake = await fakeModel(t, { dims: 8 })
  const live = await evalRun(['--ranker=embed', '--embed-live', '--ollama-url=' + fake.url, '--json', '--split=holdout'])
  assert.equal(live.status, 0, live.stderr)
  const liveOut = JSON.parse(live.stdout)
  assert.equal(liveOut.embed.connected, true)
  assert.equal(liveOut.embed.kind, 'ollama:' + DEFAULT_MODEL)
  assert.equal(liveOut.embed.dim, 8)
  assert.match(liveOut.embed.note, /真向量（bge-m3/)
  assert.ok(liveOut.embed.cacheSize > 200, '200 条经历 + 查询都要预热进去')
  assert.equal(typeof liveOut.rankers.embed.recall10, 'number')
  assert.equal(liveOut.rankers.embed.leaks, 0)

  const human = await evalRun(['--ranker=embed', '--embed-live', '--ollama-url=' + fake.url, '--split=holdout'])
  assert.equal(human.status, 0)
  assert.match(human.stdout, /真向量（bge-m3，dim=8/)

  // 3) 请求了真模型但连不上：照实打桩，写明原因，仍然跑得完
  const dead = await evalRun(['--ranker=embed', '--embed-live', '--ollama-url=http://127.0.0.1:1', '--json', '--split=holdout'])
  assert.equal(dead.status, 0)
  const deadOut = JSON.parse(dead.stdout)
  assert.equal(deadOut.embed.connected, false)
  assert.match(deadOut.embed.note, /未接入真模型/)
  assert.ok(deadOut.embed.reason, '要把不可用的原因带进报告')
  assert.match(dead.stderr, /真模型不可用/)
  assert.equal(typeof deadOut.rankers.embed.recall10, 'number')
})

test('N1：让评测用缓存却没预热全——直接失败退出，不静默退回桩', async (t) => {
  const dir = NEW(t)
  const file = path.join(dir, 'partial.jsonl')
  const fake = await fakeModel(t, { dims: 8 })
  await embed(['只预热了一条'], { file, url: fake.url, model: DEFAULT_MODEL })
  const res = await evalRun(['--ranker=embed', '--embed-cache=' + file, '--json', '--split=holdout'])
  assert.equal(res.status, 3, '缓存不全要退出 3，不能跑出个桩的数字')
  assert.match(res.stderr, /缓存缺/)
  assert.equal(res.stdout.trim(), '', '不许产出看起来正常的报告')

  // warm 也走同一套校验：维度不符时预热失败、不留半份缓存
  const five = await fakeModel(t, { dims: 5 })
  const another = path.join(dir, 'warm-bad.jsonl')
  await assert.rejects(
    () => warmEmbedCache({ texts: ['x'], file: another, url: five.url, model: DEFAULT_MODEL, dim: 8 }),
    (e) => e.code === 'EMBED_DIM_MISMATCH'
  )
  assert.equal(fs.existsSync(another), false)
})