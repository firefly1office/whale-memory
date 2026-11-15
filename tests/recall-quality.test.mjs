import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from '../packages/core/lib/self-experience.js'

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-quality-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// 合成一套“陪伴角色三个月、每天两三条”的语料：200 条，涵盖真实会出现的闲聊
const STEMS = [
  '今天读了一点关于深海热泉的文章，说那里的生物不靠阳光',
  '他说他昨天买了什么东西，我没记住是什么',
  '下午什么也没做，翻了翻股票软件，绿的',
  '广义相对论那个比喻我一直没想明白，什么叫时空弯曲',
  '灯塔那一章读完了，守灯人整晚没睡',
  '折纸又折了一遍，这次像样了',
  '码头上有船进港，风很大',
  '下雨没带伞，躲在书店门口',
  '泡了一杯茶，忘了喝，凉了',
  '晚上把第三章读完了，她也想让晚归的船看见灯',
  '他说今天有点累，我就没多说',
  '把窗户关上，屋里安静下来',
  '想起小时候的事，记不太清细节',
  '写了一页笔记，写完又觉得没什么用',
  '看了一会儿云，没看出什么形状',
  '把书放回架子上，忘了插在哪一格',
  '晚上十一点，外面没什么声音',
  '他说周末要去一趟外地，没说去哪',
  '把昨天的纸翻出来，重新折了一次',
  '灯亮着，我在等一句话，没说出口'
]

test('防编造：长而具体的无关查询，在 200 条语料里应当为空', (t) => {
  const dir = tmp(t)
  for (let i = 0; i < 200; i++) {
    exp.addExperience(dir, { text: STEMS[i % STEMS.length] + '（第' + (i + 1) + '天）' })
  }

  for (const q of ['量子力学与广义相对论', '我昨天买了什么股票', '深海热泉的化能合成']) {
    const hits = exp.recall(dir, q, { limit: 5 })
    assert.deepEqual(hits.map((h) => h.then.text), [], '不该凑：' + q)
  }
})

test('防编造：常见虚词单独查询不返回东西', (t) => {
  const dir = tmp(t)
  for (let i = 0; i < 30; i++) exp.addExperience(dir, { text: STEMS[i % STEMS.length] })
  for (const q of ['今天', '什么', '我的', '是不是', '怎么']) {
    assert.equal(exp.recall(dir, q, { limit: 5 }).length, 0, '虚词查询不该命中：' + q)
  }
})

test('该中的仍然中：短查询和具体名词照常召回', (t) => {
  const dir = tmp(t)
  const target = exp.addExperience(dir, { text: '灯塔那一章读完了，守灯人整晚没睡' })
  for (let i = 0; i < 50; i++) exp.addExperience(dir, { text: '无关的日常记录 ' + i })

  const hits = exp.recall(dir, '灯塔', { limit: 3 })
  assert.equal(hits[0].id, target.id)
  assert.equal(exp.recall(dir, '守灯人', { limit: 3 })[0].id, target.id)
})