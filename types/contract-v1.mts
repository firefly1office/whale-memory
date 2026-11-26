// 1.0 **稳定面**的类型冒烟（`docs/contract-v1-zh.md` §0.1）。
//
// 这个文件只被 `tsc --noEmit` 编译、从不执行——它断言的是**类型声明对契约面的覆盖**：
// 契约点名的每个 API / 字段 / 枚举 / 错误形状，`.d.ts` 里都得有，且类型对得上。
// 编译不过 = 宿主照契约写代码会报类型错，等于契约面出现了静默缺口。
//
// 只碰 §0.1 的承诺面。子路径导出（storage/*）还没有 .d.ts，故意不在这里写——
// 那是个已知缺口，写在 docs/host-boundary-zh.md 的"还没做到"里，不靠这条测试假装有。
import type {
  Experience, AsOf, Weight, StorageBackendName, Quote, LaterEntry
} from '../packages/core/lib/self-experience.js'
import { addExperience, loadAll, recall, setSealed, reviseExperience } from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import type { EraseResult } from '../packages/core/lib/erase.js'
import { exportMemory } from '../packages/core/lib/export-memory.js'
import { renderBook } from '../packages/core/lib/book.js'

const dir = '/tmp/whale-contract'

// §0.1-1 / §3.1-*：写入返回整条记录；then.* 与枚举值都在类型里
const made: Experience = addExperience(dir, {
  text: '契约面',
  scene: '屋里',
  feeling: ['平静'],
  thought: '想到',
  unfinished: '没弄完',
  weight: 'important',
  kind: '自己',
  state: { where: '家' },
  source: 'own-time'
})
const id: string = made.id
const weight: Weight = made.weight
const day: string = made.day
const at: string = made.at
const text: string = made.then.text
const quote: Quote | null | undefined = made.then.quote
const later: LaterEntry[] = made.later
const refs: string[] | undefined = made.then.refs

// §0.1-2 / §2.2-5 / §2.3-*：读结果上的契约字段（sealed 是派生的，不在记录里）
const asOf: AsOf = '2026-11-15'
const backend: StorageBackendName = 'file'
const rows: Experience[] = loadAll(dir, { asOf, allowCorrupt: false, allowSealCorrupt: false, backend })
const sealedOfRow: { at: string; day: string; note: string; afterAsOf?: boolean } | undefined = rows[0]?.sealed
const afterAsOf: boolean | undefined = rows[0]?.sealed?.afterAsOf

// §0.1-1 / §3.3-*：召回的参数面（契约点名的那些都在）
const hits: Experience[] = recall(dir, '契约', {
  limit: 3,
  includeSealed: false,
  asOf,
  backend,
  ranker: 'literal',
  gate: 'cover',
  mode: 'strict',
  mark: false
})

// §0.1-4 / §3.4-*：封存的返回形状是「必有 ok，其余可选」，失败走 error 而不是异常
const sealRes = setSealed(dir, { id, sealed: true, note: '理由' })
const sealOk: boolean = sealRes.ok
const sealNoop: boolean | undefined = sealRes.noop
const sealSealed: boolean | undefined = sealRes.sealed
const sealError: string | undefined = sealRes.ok ? undefined : sealRes.error

// §3.5-*：改主意（feeling 两种写法都收）
const revisedArray = reviseExperience(dir, { id, thought: '后记', reason: '复盘', feeling: ['释然'] })
const revisedString = reviseExperience(dir, { id, thought: '后记', feeling: '释然' })
const revisedOk: boolean = revisedArray.ok && revisedString.ok

// §1-2 / §1-3：擦除返回形状（墓碑字段是承诺面：id / at / reason / hash，没有正文）
const erased: EraseResult = eraseExperience(dir, { id, reason: '她要求撤回', actor: 'self' })
const alreadyGone: boolean = erased.alreadyGone
const hash: string | undefined = erased.hash
const tombstone: boolean = erased.tombstone

// §3.6-*：导出两个口径（整份 vs 排除封存）与展示型导出
const full: string = exportMemory(dir, { includeSealed: true, backend })
const withoutSealed: string = exportMemory(dir, { includeSealed: false, from: '2026-11-01', to: '2026-11-30' })
const md: string = renderBook(dir, { asOf, includeSealed: false })

console.log(
  id, weight, day, at, text, quote, later.length, refs, asOf, backend, sealedOfRow, afterAsOf,
  hits.length, sealOk, sealNoop, sealSealed, sealError, revisedOk, alreadyGone, hash, tombstone,
  full.length, withoutSealed.length, md.length
)