// 十行示例：存一版、改一版、读回、翻历史。
// 运行：node packages/drafts/example.mjs
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { saveDraft, readDraft, listHistory } from './index.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-drafts-'))
const scopeKey = 'private:owner'
const itemId = 'story-1'

console.log(saveDraft(dir, { scopeKey, itemId, baseRevision: 0, text: '灯灭的时候，海刚好退了。' })) // revision 1
console.log(saveDraft(dir, { scopeKey, itemId, baseRevision: 1, text: '灯灭的时候，海刚好退了。\n\n她数了三下。' })) // revision 2

// 用旧基线改：被拒绝，并告诉你现在是第几版
console.log(saveDraft(dir, { scopeKey, itemId, baseRevision: 1, text: '直接覆盖' })) // conflict, currentRevision: 2

console.log(readDraft(dir, { scopeKey, itemId })) // revision 2
console.log(listHistory(dir, { scopeKey, itemId })) // 两版

fs.rmSync(dir, { recursive: true, force: true })