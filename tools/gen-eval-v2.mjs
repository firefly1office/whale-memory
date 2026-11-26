#!/usr/bin/env node
// 阶段 2 的评测集生成器：eval/corpus-v2.json（200 条经历）+ eval/cases-v2.json（160+ 条用例）
//
// 为什么要有这个脚本：33 条语料上比算法得不出结论（交接里第 6 条坑）。语料扩到 200 条以后，
// 「谁挑的题、按什么规则挑的」必须能复跑，否则过几个月没人说得清这些数字是怎么来的。
//
// 组成：
//   - 前 33 条从 eval/corpus.json 原样带过来（旧语料不删，回归还要用），它们的操作也一起带；
//   - 后 167 条写在本文件里（虚构角色「小舟」的十一月到二月），标注写在事件边上：
//       para  → 同义改写的查询（故意换说法）
//       combo → 多约束（人 / 时间 / 事）
//       turn  → 多轮追问：prev 是上一轮查询，q 是这一轮的代词或省略式追问
//   - exact 用例单独列在 EXACT_CASES（查询词要么是正文里的短语、要么是旧语料里的词，
//     要求在 200 条语料里恰好出现一次，脚本会查）。
//
// 全部是编的，不来自任何真实角色、真实聊天。生成是确定性的：同一份数据跑几次字节都一样。
//
// 用法：
//   node tools/gen-eval-v2.mjs              写 eval/corpus-v2.json 与 eval/cases-v2.json
//   node tools/gen-eval-v2.mjs --check      只校验磁盘上的产物与脚本一致（CI 用）
//   node tools/gen-eval-v2.mjs --json       把统计打到 stdout
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const OLD = JSON.parse(fs.readFileSync(path.join(root, 'eval/corpus.json'), 'utf8'))
const OUT_CORPUS = path.join(root, 'eval/corpus-v2.json')
const OUT_CASES = path.join(root, 'eval/cases-v2.json')
const SEED = 20261126
const asJson = process.argv.includes('--json')
const check = process.argv.includes('--check')

// 新经历。id / at / kind / text / thought / feel 是正文；key / para / combo / turn 只用来生成用例。
const NEW_EVENTS = [
  // ── 十一月：校刊、初雪、重新开始写 ────────────────────────────────────
  { id: 'e34', at: '2026-11-03T12:10:00.000Z', kind: '其它',
    text: '把换季的衣服从箱子里翻出来，发现去年大衣口袋里有一张旧公交卡', thought: '像收到去年的自己留的礼物', feel: ['惊喜'],
    para: '翻衣服翻出一张旧卡', combo: '大衣 口袋 公交卡' },
  { id: 'e35', at: '2026-11-04T11:30:00.000Z', kind: '写东西',
    text: '校刊编辑部回信，说小说排进十二月那一期', thought: '原来等一封信要这么久', feel: ['高兴'],
    para: '校刊把我的故事排上了', combo: '校刊 回信 十二月',
    turn: { prev: '校刊把我的小说投出去以后', q: '后来有回信吗' } },
  { id: 'e36', at: '2026-11-04T13:20:00.000Z', kind: '其它',
    text: '把博客的旧文章整理成一个目录，一共二十七篇', thought: '原来我写过这么多', feel: ['满足'],
    para: '给博客做了个目录', combo: '博客 目录 二十七篇' },
  { id: 'e37', at: '2026-11-05T10:40:00.000Z', kind: '其它',
    text: '去花店买了一束小雏菊，插在窗台的玻璃瓶里', thought: '房间一下子亮了', feel: ['开心'],
    para: '买花插在瓶子里', combo: '花店 雏菊 玻璃瓶' },
  { id: 'e38', at: '2026-11-05T13:00:00.000Z', kind: '想事',
    text: '阿禾说她寒假要去南方找她妈妈，可能要待一个月', thought: '她走之后学校会安静一点', feel: ['舍不得'],
    para: '阿禾寒假去南方看妈妈', combo: '阿禾 寒假 南方' },
  { id: 'e39', at: '2026-11-06T11:00:00.000Z', kind: '其它',
    text: '第一次做葱油面，葱炸糊了，整碗面是苦的', thought: '火太大，下次最后放葱', feel: ['懊恼'],
    para: '学做葱油拌面翻车', combo: '葱油面 葱 糊' },
  { id: 'e40', at: '2026-11-06T13:30:00.000Z', kind: '其它',
    text: '手机屏幕摔裂了一道，贴了张膜继续用', thought: '还能用就不换', feel: ['无奈'],
    para: '手机摔了一道口子', combo: '手机 屏幕 膜' },
  { id: 'e41', at: '2026-11-07T07:00:00.000Z', kind: '其它',
    text: '图书馆的整理志愿者第一次上岗，按编号排了三个书架', thought: '书比人安静', feel: ['专注'],
    para: '去图书馆当志愿者排书', combo: '图书馆 志愿者 书架' },
  { id: 'e42', at: '2026-11-07T14:00:00.000Z', kind: '写东西',
    text: '把小说结尾又改了一版，删掉最后三句话', thought: '少说一点反而清楚', feel: ['踏实'],
    para: '小说结尾改短了', combo: '小说 结尾 三句话' },
  { id: 'e43', at: '2026-11-08T12:00:00.000Z', kind: '读书',
    text: '开始读《候鸟旅馆》，讲一个每年换城市住的人', thought: '总换地方会不会没有朋友', feel: ['好奇'],
    para: '读一本讲到处搬家的人的书', combo: '候鸟旅馆 城市 搬家' },
  { id: 'e44', at: '2026-11-08T13:10:00.000Z', kind: '想事',
    text: '听见楼下有小孩在吹口琴，吹的是一首很老的歌', thought: '老歌怎么都记得住', feel: ['怀念'],
    para: '楼下有人吹口琴', combo: '口琴 楼下 老歌' },
  { id: 'e45', at: '2026-11-09T11:20:00.000Z', kind: '其它',
    text: '收音机开始有杂音，转天线也没用', thought: '又要拆了', feel: ['烦'],
    para: '收音机声音不清楚了', combo: '收音机 杂音 天线' },
  { id: 'e46', at: '2026-11-10T12:40:00.000Z', kind: '读书',
    text: '读完《候鸟旅馆》，最后她留在了冬天', thought: '留下来也是走的一种', feel: ['怅然'],
    para: '那本讲搬家的书读完了', combo: '候鸟旅馆 冬天 读完' },
  { id: 'e47', at: '2026-11-10T13:00:00.000Z', kind: '其它',
    text: '在旧货市场淘到一个铁皮盒，里面有一张一九九八年的公交票', thought: '上一个用这个盒子的人在哪儿', feel: ['好奇'],
    para: '旧货市场买的小铁盒', combo: '铁皮盒 公交票 旧货市场' },
  { id: 'e48', at: '2026-11-11T10:30:00.000Z', kind: '发呆',
    text: '今年第一场雪，比往年早了半个月', thought: '雪来得这么急', feel: ['意外'],
    para: '下雪了，比往年早', combo: '雪 往年 半个月' },
  { id: 'e49', at: '2026-11-11T13:00:00.000Z', kind: '其它',
    text: '教室的暖气片响了一整节课，像有人在里面敲', thought: '听着听着就听不进去课了', feel: ['走神'],
    para: '教室暖气一直响', combo: '暖气片 教室 响' },
  { id: 'e50', at: '2026-11-12T11:40:00.000Z', kind: '其它',
    text: '买了一袋橘子，酸得皱眉', thought: '看着挺甜的', feel: ['失望'],
    para: '橘子太酸', combo: '橘子 酸 皱眉' },
  { id: 'e51', at: '2026-11-12T13:20:00.000Z', kind: '写东西',
    text: '校刊印出来了，翻到自己小说那一页，纸有点凉', thought: '真的印出来了', feel: ['激动'],
    para: '校刊出来了，翻到自己的故事', combo: '校刊 印出来 小说',
    turn: { prev: '校刊把我的小说排进哪一期了', q: '那期后来印出来了吗' } },
  { id: 'e52', at: '2026-11-13T12:10:00.000Z', kind: '其它',
    text: '宿舍楼停水两个小时，用矿泉水刷了牙', thought: '停水比停电麻烦', feel: ['狼狈'],
    para: '宿舍没水了两个小时', combo: '宿舍 停水 矿泉水' },
  { id: 'e53', at: '2026-11-13T13:30:00.000Z', kind: '其它',
    text: '志愿者排班表贴出来，我被排在周五下午', thought: '周五图书馆人少', feel: ['平常'],
    para: '志愿者排班定了', combo: '志愿者 排班 周五' },
  { id: 'e54', at: '2026-11-14T11:00:00.000Z', kind: '想事',
    text: '纠结要不要报名交换生项目，要交一份申请和成绩单', thought: '换个城市会不一样吗', feel: ['犹豫'],
    para: '在想要不要去交换', combo: '交换生 申请 成绩单',
    unfinished: '到底要不要报名交换生' },
  { id: 'e55', at: '2026-11-14T12:30:00.000Z', kind: '读书',
    text: '在书架最里面发现一本没人借过的旧诗集，借书卡上最后一个日期是二〇〇九年', thought: '十五年没人翻过它', feel: ['心疼'],
    para: '发现一本没人借的诗集', combo: '诗集 借书卡 二〇〇九' },
  { id: 'e56', at: '2026-11-15T11:00:00.000Z', kind: '想事',
    text: '给外婆打电话，她说院子里的桂花今年开得晚', thought: '桂花也在等天气', feel: ['温暖'],
    para: '外婆说今年桂花开得迟', combo: '外婆 桂花 开得晚' },
  { id: 'e57', at: '2026-11-15T12:40:00.000Z', kind: '其它',
    text: '学会用口哨吹那首很老的歌，吹到一半忘了调', thought: '记住一句是一句', feel: ['好笑'],
    para: '用嘴吹出那首歌', combo: '口哨 老歌 跑调' },
  { id: 'e58', at: '2026-11-16T11:10:00.000Z', kind: '读书',
    text: '读完《候鸟旅馆》后写了读书笔记，抄了一段关于车站的话', thought: '车站最适合告别', feel: ['安静'],
    para: '给那本书写了笔记', combo: '读书笔记 车站 抄' },
  { id: 'e59', at: '2026-11-16T13:00:00.000Z', kind: '发呆',
    text: '雾很大，学校钟楼只看得见一半', thought: '另一半像被藏起来了', feel: ['好奇'],
    para: '起雾了，钟楼只剩半边', combo: '雾 钟楼 一半' },
  { id: 'e60', at: '2026-11-17T11:30:00.000Z', kind: '其它',
    text: '把换季的厚被子拿出来晒，晒完有太阳的味道', thought: '这个味道睡进去就安心', feel: ['满足'],
    para: '把被子拿出去晒', combo: '被子 晒 太阳' },
  { id: 'e61', at: '2026-11-17T13:00:00.000Z', kind: '写东西',
    text: '开始写一个新故事，讲一个在灯塔上长大的女孩', thought: '灯塔里长大会不会怕黑', feel: ['兴奋'],
    para: '新故事写灯塔里的孩子', combo: '新故事 灯塔 女孩' },
  { id: 'e62', at: '2026-11-18T10:20:00.000Z', kind: '其它',
    text: '帮楼下的阿姨把两大箱快递搬上五楼', thought: '她一个人搬不动', feel: ['累'],
    para: '帮邻居搬箱子上楼', combo: '阿姨 快递 五楼' },
  { id: 'e63', at: '2026-11-18T11:30:00.000Z', kind: '想事',
    text: '阿禾说她想了想，先不退话剧社，只请两周假', thought: '她还是有舍不得的', feel: ['松一口气'],
    para: '阿禾决定留在话剧社', combo: '阿禾 话剧社 两周假', weight: 'important',
    turn: { prev: '阿禾说她想退出话剧社', q: '她后来退了吗' } },
  { id: 'e64', at: '2026-11-18T12:50:00.000Z', kind: '读书',
    text: '读《候鸟旅馆》里写车站的那一章，车站的钟总是慢五分钟', thought: '慢五分钟刚好来得及', feel: ['喜欢'],
    para: '书里写车站的钟不准', combo: '车站 钟 五分钟' },
  { id: 'e65', at: '2026-11-19T11:00:00.000Z', kind: '其它',
    text: '同学在走廊里说看到了我的小说，我假装没听清', thought: '不知道该高兴还是不好意思', feel: ['别扭'],
    para: '同学说在走廊看到我的故事', combo: '走廊 同学 小说' },
  { id: 'e66', at: '2026-11-19T13:40:00.000Z', kind: '想事',
    text: '室友半夜打呼噜，我把耳塞找出来戴上', thought: '明天要跟她说一声', feel: ['无奈'],
    para: '室友打呼我戴耳塞', combo: '室友 呼噜 耳塞' },
  { id: 'e67', at: '2026-11-20T10:00:00.000Z', kind: '读书',
    text: '开始读《慢船去北方》，书页有股旧纸味', thought: '旧书像旧房子', feel: ['安静'],
    para: '开始读一本讲开往北方的船的书', combo: '慢船去北方 旧纸味 开头' },
  { id: 'e68', at: '2026-11-20T12:30:00.000Z', kind: '其它',
    text: '第一次去做家教，教一个初二的男孩数学', thought: '他比我还紧张', feel: ['紧张'],
    para: '去给初中生补课', combo: '家教 初二 数学' },
  { id: 'e69', at: '2026-11-20T13:15:00.000Z', kind: '想事',
    text: '家教那孩子说他其实喜欢地理，不喜欢数学', thought: '喜欢的东西才有耐心', feel: ['明白'],
    para: '那孩子偏科', combo: '家教 地理 数学' },
  { id: 'e70', at: '2026-11-21T11:20:00.000Z', kind: '其它',
    text: '话剧社排练《星期四的雨》，我去帮忙做道具', thought: '做道具比排练好玩', feel: ['开心'],
    para: '话剧排练帮忙做道具', combo: '话剧社 星期四的雨 道具' },
  { id: 'e71', at: '2026-11-21T12:40:00.000Z', kind: '发呆',
    text: '走操场走了三圈，看见有人放风筝', thought: '冬天也能放风筝', feel: ['平静'],
    para: '散步时看见风筝', combo: '操场 风筝 三圈' },
  { id: 'e72', at: '2026-11-22T11:30:00.000Z', kind: '想事',
    text: '感冒了，嗓子疼，喝了三杯热水', thought: '明天别说话了', feel: ['难受'],
    para: '感冒喉咙痛', combo: '感冒 嗓子 热水' },
  { id: 'e73', at: '2026-11-22T13:00:00.000Z', kind: '其它',
    text: '整理书架，把没读的书摞成一摞', thought: '买书比读书快', feel: ['心虚'],
    para: '把没看的书堆一起', combo: '书架 摞 没读' },
  { id: 'e74', at: '2026-11-23T10:40:00.000Z', kind: '其它',
    text: '拆开收音机清灰，装回去多了一颗螺丝', thought: '这颗是哪儿来的', feel: ['迷惑'],
    para: '修收音机剩颗螺丝', combo: '收音机 螺丝 拆' },
  { id: 'e75', at: '2026-11-23T12:00:00.000Z', kind: '想事',
    text: '决定不报交换生，想留在熟悉的城市', thought: '熟悉也是一种理由', feel: ['平静'],
    para: '最后没去交换', combo: '交换生 不报 城市',
    turn: { prev: '要不要报名交换生项目', q: '最后去了吗' } },
  { id: 'e76', at: '2026-11-23T13:30:00.000Z', kind: '读书',
    text: '读到《慢船去北方》里写北方港口的段落，风把旗子吹得笔直', thought: '港口的旗子比船好看', feel: ['着迷'],
    para: '书里写的港口', combo: '北方港口 旗子 风' },
  { id: 'e77', at: '2026-11-24T11:10:00.000Z', kind: '写东西',
    text: '新故事写到一半卡住了，扔在文档里没动', thought: '是不是写得太顺了反而假', feel: ['烦躁'],
    para: '那个故事写不下去了', combo: '新故事 卡住 文档',
    unfinished: '卡住的那段怎么写下去' },
  { id: 'e78', at: '2026-11-24T12:30:00.000Z', kind: '其它',
    text: '晾的衣服忘了收，被雨淋了一夜', thought: '早上起来全湿了', feel: ['懊恼'],
    para: '忘了收衣服', combo: '衣服 雨 晾' },
  { id: 'e79', at: '2026-11-25T11:00:00.000Z', kind: '其它',
    text: '发烧到三十八度，室友替我带了粥', thought: '原来有人记得我没吃饭', feel: ['温暖'],
    para: '烧到三十八度', combo: '发烧 室友 粥' },
  { id: 'e80', at: '2026-11-25T13:20:00.000Z', kind: '想事',
    text: '烧退了，胃口还没回来，只吃了半个馒头', thought: '身体比脑子先知道累', feel: ['虚弱'],
    para: '烧退了没胃口', combo: '退烧 胃口 馒头' },
  { id: 'e81', at: '2026-11-26T11:30:00.000Z', kind: '想事',
    text: '和妈妈在电话里吵了一架，挂了以后在楼梯上坐了很久', thought: '我们都在说自己的道理', feel: ['委屈', '生气'],
    markers: ['和妈妈在电话里吵了一架', '在楼梯上坐了很久'] },
  { id: 'e82', at: '2026-11-26T13:00:00.000Z', kind: '其它',
    text: '修好了宿舍门上的锁，是里面的弹簧卡住了', thought: '修东西让人安心', feel: ['得意'],
    para: '把门锁修好', combo: '门锁 弹簧 宿舍' },
  { id: 'e83', at: '2026-11-27T10:30:00.000Z', kind: '其它',
    text: '做葱油面第二次，这次葱炸得刚好，还煎了个蛋', thought: '第二次就对了', feel: ['得意'],
    para: '再试一次葱油面', combo: '葱油面 葱 煎蛋' },
  { id: 'e84', at: '2026-11-27T12:00:00.000Z', kind: '其它',
    text: '冬至，和室友一起包饺子，我包的都露馅', thought: '捏边要蘸水', feel: ['好笑'],
    para: '冬至包饺子', combo: '冬至 饺子 露馅' },
  { id: 'e85', at: '2026-11-28T11:00:00.000Z', kind: '其它',
    text: '和阿禾去吃了新开的面馆，她加了很多醋', thought: '醋放多了她也不嫌', feel: ['轻松'],
    para: '跟阿禾去吃面', combo: '面馆 阿禾 醋' },
  { id: 'e86', at: '2026-11-28T12:30:00.000Z', kind: '读书',
    text: '把《候鸟旅馆》借给阿禾，她说要带去南方看', thought: '书比我先去南方', feel: ['舍不得'],
    para: '那本书借给阿禾了', combo: '候鸟旅馆 借 阿禾' },
  { id: 'e87', at: '2026-11-29T11:30:00.000Z', kind: '其它',
    text: '家教那孩子小测进步了十分，他妈妈留我吃了饭', thought: '被留下吃饭有点不好意思', feel: ['高兴'],
    para: '补课的小孩考好了', combo: '家教 小测 十分' },
  { id: 'e88', at: '2026-11-29T13:10:00.000Z', kind: '其它',
    text: '把读书笔记投给班级的手抄报，被退回来了，说字数太多', thought: '什么都嫌长', feel: ['沮丧'],
    para: '笔记投稿被退回', combo: '手抄报 读书笔记 字数' },
  { id: 'e89', at: '2026-11-30T10:20:00.000Z', kind: '其它',
    text: '那颗多出来的螺丝原来卡在电池仓里，取出来以后收音机又响了', thought: '原来问题这么小', feel: ['惊喜'],
    para: '收音机修好了', combo: '螺丝 电池仓 收音机',
    turn: { prev: '拆收音机多出来一颗螺丝', q: '那颗螺丝后来找到了吗' } },
  { id: 'e90', at: '2026-11-30T12:00:00.000Z', kind: '其它',
    text: '食堂换了新菜单，价格涨了一块钱', thought: '一块钱也是钱', feel: ['平常'],
    para: '食堂菜贵了一块', combo: '食堂 菜单 涨价' },
  // ── 十二月：样刊、演出、期末前的冬天 ──────────────────────────────────
  { id: 'e91', at: '2026-12-01T11:10:00.000Z', kind: '其它',
    text: '把卡住的那段新故事读给阿禾听，她说写得太满了', thought: '满在哪里', feel: ['受挫'],
    para: '阿禾说故事太满', combo: '新故事 阿禾 太满',
    turn: { prev: '新故事读给阿禾听', q: '她说太满是什么意思' } },
  { id: 'e92', at: '2026-12-01T13:00:00.000Z', kind: '发呆',
    text: '月亮很圆，走到操场看了一会儿', thought: '冷得鼻子发酸', feel: ['平静'],
    para: '夜里去看月亮', combo: '月亮 操场 圆' },
  { id: 'e93', at: '2026-12-02T11:30:00.000Z', kind: '其它',
    text: '拿到两本校刊样刊，一本打算寄给外婆', thought: '她会在电话里念给别人听', feel: ['高兴'],
    para: '拿到两本样刊', combo: '样刊 外婆 寄',
    turn: { prev: '校刊印出来了', q: '样刊拿到了吗' } },
  { id: 'e94', at: '2026-12-02T13:00:00.000Z', kind: '其它',
    text: '帮一个找不到书的老爷爷查到书在四楼', thought: '他说谢谢的时候眼睛亮了一下', feel: ['开心'],
    para: '帮老人查书', combo: '老爷爷 图书馆 四楼' },
  { id: 'e95', at: '2026-12-03T10:50:00.000Z', kind: '其它',
    text: '走操场两周，膝盖不疼了', thought: '慢慢走也有用', feel: ['轻松'],
    para: '走圈之后膝盖好点', combo: '操场 膝盖 两周' },
  { id: 'e96', at: '2026-12-03T12:20:00.000Z', kind: '想事',
    text: '感冒好了，鼻子通了，才发现冬天的空气有味道', thought: '感冒的时候什么都闻不到', feel: ['清爽'],
    para: '病好了才闻到冬天', combo: '感冒 鼻子 空气' },
  { id: 'e97', at: '2026-12-04T11:00:00.000Z', kind: '其它',
    text: '话剧演出那天，阿禾演一个只出现三分钟的角色', thought: '三分钟她也练了一个月', feel: ['紧张'],
    para: '话剧演出那天', combo: '话剧 阿禾 三分钟' },
  { id: 'e98', at: '2026-12-04T13:30:00.000Z', kind: '想事',
    text: '谢幕的时候阿禾哭了，我在台下鼓掌', thought: '她大概是松了一口气', feel: ['感动'], weight: 'important',
    para: '演出结束她哭了', combo: '谢幕 阿禾 鼓掌',
    turn: { prev: '阿禾演的那场话剧', q: '谢幕的时候她怎么了' } },
  { id: 'e99', at: '2026-12-05T10:40:00.000Z', kind: '其它',
    text: '冬天手干裂，涂了厚厚的护手霜', thought: '明年要早点涂', feel: ['平常'],
    para: '手裂了涂油', combo: '手 干裂 护手霜' },
  { id: 'e100', at: '2026-12-05T12:10:00.000Z', kind: '读书',
    text: '开始读一本讲植物过冬的书，说树会降低细胞里的水', thought: '树也在熬', feel: ['着迷'],
    para: '读讲树怎么过冬的书', combo: '植物 过冬 细胞' },
  { id: 'e101', at: '2026-12-06T11:20:00.000Z', kind: '想事',
    text: '阿禾给我看了她寒假去南方的车票，是硬座', thought: '十几个小时硬座', feel: ['心疼'],
    para: '阿禾买好南下的票', combo: '车票 硬座 南方' },
  { id: 'e102', at: '2026-12-07T10:30:00.000Z', kind: '其它',
    text: '宿舍楼的门禁换了刷卡系统，旧卡不能用了', thought: '又得去办新卡', feel: ['麻烦'],
    para: '宿舍换了门禁', combo: '门禁 刷卡 旧卡' },
  { id: 'e103', at: '2026-12-07T13:00:00.000Z', kind: '其它',
    text: '又去了一次海洋博物馆，这次看的是深海展区', thought: '深海的鱼长得像另一个星球', feel: ['着迷'],
    para: '博物馆的深海展', combo: '海洋博物馆 深海 展区' },
  { id: 'e104', at: '2026-12-08T11:40:00.000Z', kind: '写东西',
    text: '删掉新故事的三分之一，重新写', thought: '删的时候手有点抖', feel: ['心疼'],
    para: '把故事砍掉一段重写', combo: '新故事 删 三分之一' },
  { id: 'e105', at: '2026-12-08T13:10:00.000Z', kind: '其它',
    text: '把书架上的书按颜色重新排了一遍', thought: '按颜色排完找书更难了', feel: ['好笑'],
    para: '把书按颜色摆', combo: '书架 颜色 排' },
  { id: 'e106', at: '2026-12-09T12:00:00.000Z', kind: '想事',
    text: '外婆寄来一箱橘子，箱底垫着旧报纸', thought: '报纸上的日期是九月', feel: ['温暖'],
    para: '收到外婆寄的橘子', combo: '外婆 橘子 旧报纸' },
  { id: 'e107', at: '2026-12-09T13:20:00.000Z', kind: '其它',
    text: '给外婆买了一副毛线手套，寄回去', thought: '她总说手冷', feel: ['满足'],
    para: '给外婆买了手套', combo: '手套 外婆 寄' },
  { id: 'e108', at: '2026-12-10T11:00:00.000Z', kind: '其它',
    text: '把这一年的照片挑出十二张，做成了一个相册', thought: '一年只留十二张', feel: ['舍不得'],
    para: '挑十二张相片做相册', combo: '照片 相册 十二张' },
  { id: 'e109', at: '2026-12-10T12:30:00.000Z', kind: '其它',
    text: '楼道里的感应灯坏了，晚上要摸着墙走', thought: '三楼那盏该换了', feel: ['烦'],
    para: '楼道灯不亮了', combo: '感应灯 楼道 摸墙' },
  { id: 'e110', at: '2026-12-11T10:40:00.000Z', kind: '其它',
    text: '和室友一起大扫除，清出三袋垃圾', thought: '原来我们攒了这么多东西', feel: ['累'],
    para: '宿舍大扫除', combo: '室友 大扫除 垃圾' },
  { id: 'e111', at: '2026-12-11T12:00:00.000Z', kind: '想事',
    text: '剪了头发，短到耳朵上面', thought: '镜子里的自己有点陌生', feel: ['不安'],
    para: '把头发剪短', combo: '头发 剪短 耳朵' },
  { id: 'e112', at: '2026-12-12T11:30:00.000Z', kind: '其它',
    text: '拿到第一个月家教工资，给外婆买了一条围巾', thought: '第一次用自己挣的钱', feel: ['骄傲'],
    para: '挣的第一笔钱', combo: '工资 外婆 围巾',
    turn: { prev: '家教工资拿到了', q: '第一笔工资给外婆买了什么' } },
  { id: 'e113', at: '2026-12-12T13:00:00.000Z', kind: '想事',
    text: '体检报告说有一项指标偏高，医生让复查', thought: '先别告诉家里', feel: ['害怕'],
    markers: ['一项指标偏高', '让复查'] },
  { id: 'e114', at: '2026-12-13T10:30:00.000Z', kind: '其它',
    text: '照镜子觉得不像自己，过两天就习惯了', thought: '头发会长回来的', feel: ['平静'],
    para: '剪完头看着别扭', combo: '镜子 头发 习惯' },
  { id: 'e115', at: '2026-12-13T11:20:00.000Z', kind: '其它',
    text: '帮阿禾挑给家人的礼物，挑了很久，最后选了一盒茶叶', thought: '她挑东西比写作业认真', feel: ['好笑'],
    para: '陪阿禾买礼物', combo: '阿禾 礼物 茶叶' },
  { id: 'e116', at: '2026-12-14T12:00:00.000Z', kind: '发呆',
    text: '下雪那天很安静，能听见雪落在窗上的声音', thought: '雪把声音都吸走了', feel: ['安静'],
    para: '下雪的晚上很静', combo: '雪 窗 安静' },
  { id: 'e117', at: '2026-12-14T13:40:00.000Z', kind: '其它',
    text: '把《慢船去北方》读到全书一半，夹了张书签', thought: '书签是一张旧车票', feel: ['平常'],
    para: '那本书看了一半', combo: '慢船去北方 一半 书签' },
  { id: 'e118', at: '2026-12-15T11:40:00.000Z', kind: '写东西',
    text: '新故事写完了，一共八千字', thought: '从卡住到写完隔了二十天', feel: ['踏实'], weight: 'important',
    para: '那个故事写完了', combo: '新故事 八千字 写完',
    turn: { prev: '新故事写完了吗', q: '写了多少字' } },
  { id: 'e119', at: '2026-12-15T13:10:00.000Z', kind: '其它',
    text: '把新故事打印出来，订成一个小册子', thought: '纸上的和屏幕上的不一样', feel: ['满足'],
    para: '把故事打印装订', combo: '打印 小册子 新故事' },
  { id: 'e120', at: '2026-12-16T12:10:00.000Z', kind: '其它',
    text: '话剧社聚餐，社长说下学期要排新戏', thought: '聚餐比排练轻松', feel: ['开心'],
    para: '话剧社一起吃饭', combo: '话剧社 聚餐 新戏' },
  { id: 'e121', at: '2026-12-17T11:00:00.000Z', kind: '其它',
    text: '用收音机录了一小段老歌，存进手机', thought: '怕以后听不到', feel: ['珍惜'],
    para: '把收音机里的歌录下来', combo: '收音机 录 老歌' },
  { id: 'e122', at: '2026-12-17T12:30:00.000Z', kind: '其它',
    text: '做红烧肉，糖色炒过了，有点苦', thought: '糖色是道坎', feel: ['懊恼'],
    para: '学做红烧肉', combo: '红烧肉 糖色 炒过' },
  { id: 'e123', at: '2026-12-18T11:10:00.000Z', kind: '想事',
    text: '冬至后白天开始变长，五点半还有点光', thought: '最黑的时候已经过去了', feel: ['安慰'],
    para: '天黑得越来越晚', combo: '白天 变长 五点半' },
  { id: 'e124', at: '2026-12-19T10:40:00.000Z', kind: '读书',
    text: '读到《慢船去北方》里写火车过隧道的段落', thought: '隧道里时间会变慢', feel: ['安静'],
    para: '书里写火车钻山洞', combo: '火车 隧道 慢船去北方' },
  { id: 'e125', at: '2026-12-19T12:00:00.000Z', kind: '其它',
    text: '平安夜，寝室里交换礼物，我抽到一包糖', thought: '糖是别人挑的', feel: ['温暖'],
    para: '寝室交换礼物', combo: '平安夜 礼物 糖' },
  { id: 'e126', at: '2026-12-20T11:30:00.000Z', kind: '其它',
    text: '给外婆打电话，她在电话里说家里下雪了', thought: '老家的雪比这里大', feel: ['想念'],
    para: '外婆说老家下雪', combo: '外婆 电话 下雪' },
  { id: 'e127', at: '2026-12-21T12:10:00.000Z', kind: '其它',
    text: '把旧毛线翻出来，试着织了一个杯垫', thought: '手还记得怎么起针', feel: ['专注'],
    para: '用旧毛线织杯垫', combo: '毛线 杯垫 织' },
  { id: 'e128', at: '2026-12-22T10:50:00.000Z', kind: '其它',
    text: '把这一年的账算了一遍，发现花在吃上的钱最多', thought: '也不算浪费', feel: ['好笑'],
    para: '算了一年的花销', combo: '账 吃 一年' },
  { id: 'e129', at: '2026-12-23T11:40:00.000Z', kind: '其它',
    text: '橘子吃完了，把橘子皮晒在窗台上', thought: '干了可以泡水', feel: ['满足'],
    para: '橘子皮摊在窗台', combo: '橘子皮 晒 窗台' },
  { id: 'e130', at: '2026-12-24T12:00:00.000Z', kind: '想事',
    text: '写年终总结，写了两页觉得自己这一年变化不大', thought: '变化是别人说的', feel: ['平常'],
    para: '写年度总结', combo: '年终 总结 两页' },
  { id: 'e131', at: '2026-12-25T11:20:00.000Z', kind: '其它',
    text: '把今年收到的明信片按日期排好', thought: '最早那张已经卷边了', feel: ['怀念'],
    para: '整理收到的明信片', combo: '明信片 日期 整理' },
  // ── 一月：期末、回家、外婆家的冬天 ────────────────────────────────────
  { id: 'e132', at: '2027-01-01T05:00:00.000Z', kind: '发呆',
    text: '元旦睡到中午，醒来发现手机有二十条未读', thought: '其实没有一条非回不可', feel: ['懒散'],
    para: '元旦睡到中午', combo: '元旦 手机 未读' },
  { id: 'e133', at: '2027-01-01T12:00:00.000Z', kind: '想事',
    text: '在阳台上听远处的烟花，看见对面楼有人在倒数', thought: '别人的热闹也很好', feel: ['平静'],
    para: '跨年听鞭炮', combo: '阳台 烟花 倒数' },
  { id: 'e134', at: '2027-01-02T11:00:00.000Z', kind: '想事',
    text: '又有点后悔没报交换生', thought: '另一种生活长什么样', feel: ['后悔'],
    para: '有点后悔没去交换', combo: '交换生 后悔 报名',
    turn: { prev: '最后没去交换', q: '后悔吗' } },
  { id: 'e135', at: '2027-01-02T12:30:00.000Z', kind: '其它',
    text: '去书店买了一本打折的字典', thought: '便宜得像捡的', feel: ['开心'],
    para: '买了一本便宜字典', combo: '书店 字典 打折' },
  { id: 'e136', at: '2027-01-03T10:40:00.000Z', kind: '其它',
    text: '牙疼去看牙医，医生说要补一颗牙', thought: '怕钻头的声音', feel: ['紧张'],
    para: '治虫牙', combo: '牙医 补牙 一颗',
    unfinished: '补完牙还会不会疼',
    turn: { prev: '牙疼去看牙医', q: '医生怎么说' } },
  { id: 'e137', at: '2027-01-03T12:00:00.000Z', kind: '其它',
    text: '家教换到周六上午，路上要坐四十分钟公交', thought: '周六起不来', feel: ['无奈'],
    para: '补课改到周末上午', combo: '家教 周六 四十分钟' },
  { id: 'e138', at: '2027-01-04T11:10:00.000Z', kind: '写东西',
    text: '把新故事投给一个征文比赛', thought: '投出去就不归我管了', feel: ['期待'],
    para: '把故事拿去参赛', combo: '征文 比赛 新故事',
    unfinished: '等征文比赛的结果',
    turn: { prev: '新故事写完了', q: '投给比赛了吗' } },
  { id: 'e139', at: '2027-01-04T12:40:00.000Z', kind: '其它',
    text: '把旧日历翻到最后一页，撕下来夹在书里', thought: '一年就剩这一张纸', feel: ['怅然'],
    para: '去年的日历撕下来', combo: '日历 最后一页 书里' },
  { id: 'e140', at: '2027-01-05T10:30:00.000Z', kind: '其它',
    text: '室友失恋，我们陪她在操场走了很多圈', thought: '能陪着走就够了', feel: ['心疼'],
    para: '陪室友散心', combo: '室友 失恋 操场' },
  { id: 'e141', at: '2027-01-05T13:00:00.000Z', kind: '想事',
    text: '丢了饭卡，挂失补办花了二十块', thought: '一天丢两次东西', feel: ['懊恼'],
    para: '饭卡不见了', combo: '饭卡 挂失 二十块' },
  { id: 'e142', at: '2027-01-06T11:40:00.000Z', kind: '其它',
    text: '操场在修，改成去体育馆走', thought: '体育馆的地板有回音', feel: ['新鲜'],
    para: '体育场施工', combo: '操场 修 体育馆' },
  { id: 'e143', at: '2027-01-06T13:00:00.000Z', kind: '其它',
    text: '宿舍楼有人练小提琴，每天七点开始', thought: '刚开始难听，后来好一点', feel: ['习惯'],
    para: '有人拉琴', combo: '小提琴 七点 宿舍楼' },
  { id: 'e144', at: '2027-01-07T10:50:00.000Z', kind: '其它',
    text: '图书馆延长到十一点，我待到闭馆', thought: '闭馆音乐比闹钟温柔', feel: ['踏实'],
    para: '在图书馆熬到关门', combo: '图书馆 十一点 闭馆' },
  { id: 'e145', at: '2027-01-07T13:30:00.000Z', kind: '其它',
    text: '在图书馆趴着睡着了，醒来围巾盖在肩上', thought: '不知道是谁盖的', feel: ['温暖'],
    para: '睡着有人给我盖围巾', combo: '图书馆 睡着 围巾' },
  { id: 'e146', at: '2027-01-08T12:00:00.000Z', kind: '其它',
    text: '补牙，打麻药的时候手心全是汗', thought: '麻药比钻头更可怕', feel: ['紧张'],
    para: '治牙打针', combo: '补牙 麻药 手心',
    turn: { prev: '补牙打麻药', q: '当时紧张吗' } },
  { id: 'e147', at: '2027-01-08T13:20:00.000Z', kind: '其它',
    text: '麻药过了有点疼，晚上只喝了粥', thought: '疼的时候只能喝粥', feel: ['难受'],
    para: '牙还疼只喝粥', combo: '麻药 疼 粥' },
  { id: 'e148', at: '2027-01-09T11:30:00.000Z', kind: '其它',
    text: '找到去年的一张展览门票，夹在书里', thought: '那次和谁去的记不清了', feel: ['恍惚'],
    para: '书里夹着一张旧票', combo: '展览门票 书里 去年' },
  { id: 'e149', at: '2027-01-09T12:40:00.000Z', kind: '其它',
    text: '学做红糖糍粑，糯米粉放多了，黏手', thought: '手上全是白的', feel: ['好笑'],
    para: '做糯米点心', combo: '红糖糍粑 糯米粉 黏' },
  { id: 'e150', at: '2027-01-10T11:00:00.000Z', kind: '其它',
    text: '下了雨夹雪，伞上结了一层冰', thought: '伞变得像一只硬壳', feel: ['狼狈'],
    para: '又下雨又飘雪', combo: '雨夹雪 伞 冰' },
  { id: 'e151', at: '2027-01-10T12:30:00.000Z', kind: '其它',
    text: '煮了一锅粥，忘了关火，糊了', thought: '糊味比粥味大', feel: ['懊恼'],
    para: '煮粥忘了火', combo: '粥 关火 糊' },
  { id: 'e152', at: '2027-01-11T12:20:00.000Z', kind: '想事',
    text: '期末周，图书馆座位要靠抢', thought: '七点开门，六点半就有人排', feel: ['紧张'],
    para: '考试周抢座位', combo: '期末 图书馆 座位' },
  { id: 'e153', at: '2027-01-11T13:40:00.000Z', kind: '其它',
    text: '把没读完的书从书架上拿下来，摞在桌角', thought: '考完再读', feel: ['平常'],
    para: '把没看完的书放桌上', combo: '书 桌角 没读完' },
  { id: 'e154', at: '2027-01-12T11:40:00.000Z', kind: '读书',
    text: '借了一本讲河流改道的书，说黄河改过很多次', thought: '河也会改主意', feel: ['着迷'],
    para: '读讲河道变迁的书', combo: '河流 改道 黄河' },
  { id: 'e155', at: '2027-01-12T12:50:00.000Z', kind: '其它',
    text: '糍粑煎好了，外脆里软，撒了黄豆粉', thought: '第二次就对', feel: ['满足'],
    para: '煎糯米点心', combo: '糍粑 黄豆粉 脆' },
  { id: 'e156', at: '2027-01-13T10:30:00.000Z', kind: '其它',
    text: '室友回家前把绿萝托付给我', thought: '我不会养花', feel: ['紧张'],
    para: '室友让我照顾她的花', combo: '绿萝 室友 托付',
    turn: { prev: '室友回家前', q: '绿萝怎么办' } },
  { id: 'e157', at: '2027-01-13T11:50:00.000Z', kind: '想事',
    text: '想到明年就要毕业，突然有点慌', thought: '时间比我想的快', feel: ['慌'],
    para: '想到要毕业有点慌', combo: '毕业 明年 慌' },
  { id: 'e158', at: '2027-01-14T11:30:00.000Z', kind: '其它',
    text: '相册打印出来，有一张拍糊了', thought: '糊的那张反而最有当时的感觉', feel: ['好笑'],
    para: '打印的照片有一张糊', combo: '相册 打印 拍糊' },
  { id: 'e159', at: '2027-01-14T12:50:00.000Z', kind: '其它',
    text: '把这一年的日记翻了一遍，发现写得最多的是冬天', thought: '冷的时候话多', feel: ['意外'],
    para: '翻了一年的日记', combo: '日记 冬天 翻' },
  { id: 'e160', at: '2027-01-15T10:40:00.000Z', kind: '想事',
    text: '给爸爸打电话，他说今年过年可能回不来', thought: '那就我和外婆过', feel: ['失落'],
    markers: ['过年可能回不来'] },
  { id: 'e161', at: '2027-01-15T12:00:00.000Z', kind: '其它',
    text: '把冬天的衣服收进箱子，拿出春天的外套', thought: '冬天这么快就过去了', feel: ['轻松'],
    para: '把厚衣服收起来', combo: '冬天 衣服 箱子' },
  { id: 'e162', at: '2027-01-16T11:20:00.000Z', kind: '其它',
    text: '在食堂吃到很好吃的冬瓜汤，连喝了两碗', thought: '汤里有姜', feel: ['满足'],
    para: '食堂的汤很好喝', combo: '食堂 冬瓜汤 两碗' },
  { id: 'e163', at: '2027-01-16T12:40:00.000Z', kind: '想事',
    text: '楼下的阿姨送了一把她自己种的青菜', thought: '她说是太多了吃不完', feel: ['温暖'],
    para: '邻居送的菜', combo: '阿姨 青菜 种' },
  { id: 'e164', at: '2027-01-17T11:00:00.000Z', kind: '其它',
    text: '期末最后一门，提前半小时交了卷', thought: '不想再检查了', feel: ['解脱'],
    para: '最后一门提前出来', combo: '期末 交卷 提前' },
  { id: 'e165', at: '2027-01-17T12:30:00.000Z', kind: '其它',
    text: '收拾行李回家，火车晚点一小时', thought: '站台上有人卖热玉米', feel: ['归心似箭'],
    para: '回家的车误点', combo: '火车 晚点 行李',
    turn: { prev: '收拾行李回家', q: '车准点吗' } },
  { id: 'e166', at: '2027-01-18T12:00:00.000Z', kind: '其它',
    text: '到家，外婆在门口等，手里拿着热红薯', thought: '她大概等了很久', feel: ['温暖'], weight: 'important',
    para: '姥姥在门口等我', combo: '外婆 门口 红薯' },
  { id: 'e167', at: '2027-01-19T10:30:00.000Z', kind: '发呆',
    text: '外婆家的桂花树冬天只剩枝，她说等秋天再来', thought: '树记得怎么等', feel: ['安静'],
    para: '外婆家的树冬天光秃秃', combo: '桂花树 冬天 枝' },
  { id: 'e168', at: '2027-01-19T11:40:00.000Z', kind: '其它',
    text: '帮外婆把院子里的雪扫出一条路', thought: '扫到门口就出汗了', feel: ['满足'],
    para: '给院子扫雪', combo: '外婆 院子 扫雪' },
  { id: 'e169', at: '2027-01-20T10:50:00.000Z', kind: '其它',
    text: '复查结果没事，虚惊一场，那一周没睡好', thought: '原来担心比结果更累', feel: ['释然'],
    para: '检查结果没问题', combo: '复查 虚惊 没睡好' },
  { id: 'e170', at: '2027-01-20T12:10:00.000Z', kind: '其它',
    text: '外婆翻出我小时候的照片，说我那时候不爱笑', thought: '照片里的我绷着脸', feel: ['好笑'],
    para: '外婆给我看老照片', combo: '外婆 照片 小时候' },
  // ── 二月：过年前后、返校 ──────────────────────────────────────────────
  { id: 'e171', at: '2027-01-21T11:30:00.000Z', kind: '其它',
    text: '陪外婆去菜市场，她砍价很厉害', thought: '摊主都认识她', feel: ['佩服'],
    para: '跟外婆去买菜时讲价', combo: '菜市场 外婆 砍价',
    turn: { prev: '陪外婆去菜市场', q: '她讲价厉害吗' } },
  { id: 'e172', at: '2027-01-21T12:50:00.000Z', kind: '其它',
    text: '阿禾在南方发来一张海的照片，说海是灰的', thought: '南方的海和想象不一样', feel: ['想念'],
    para: '阿禾拍的海', combo: '阿禾 海 灰' },
  { id: 'e173', at: '2027-01-22T11:40:00.000Z', kind: '其它',
    text: '收音机里放了一首外婆爱听的歌', thought: '外婆跟着哼了两句', feel: ['温暖'],
    para: '收音机里那首老歌', combo: '收音机 外婆 歌' },
  { id: 'e174', at: '2027-01-22T12:30:00.000Z', kind: '其它',
    text: '外婆腌了一坛咸菜，说等过年吃', thought: '坛子比我年纪还大', feel: ['好奇'],
    para: '外婆准备了腌菜', combo: '外婆 咸菜 过年' },
  { id: 'e175', at: '2027-01-23T10:40:00.000Z', kind: '其它',
    text: '把铁皮盒用来装拍立得照片', thought: '铁皮盒终于有用了', feel: ['满足'],
    para: '小铁盒装照片', combo: '铁皮盒 拍立得 照片' },
  { id: 'e176', at: '2027-01-23T12:00:00.000Z', kind: '想事',
    text: '征文比赛结果出来，没进终评', thought: '有点难过但也没有很意外', feel: ['失落'],
    para: '比赛结果不好', combo: '征文 落选 终评' },
  { id: 'e177', at: '2027-01-24T11:00:00.000Z', kind: '想事',
    text: '没进终评也没什么，把稿子收进文件夹', thought: '写完它就是它自己的事了', feel: ['平静'],
    para: '把落选的稿子收好', combo: '稿子 文件夹 落选',
    turn: { prev: '征文没进终评', q: '稿子收起来了吗' } },
  { id: 'e178', at: '2027-01-24T12:30:00.000Z', kind: '想事',
    text: '阿禾回来，晒黑了，带回一包海鲜干货', thought: '她说话的口音变了一点', feel: ['开心'],
    para: '阿禾从南方回来', combo: '阿禾 回来 海鲜' },
  { id: 'e179', at: '2027-01-25T11:50:00.000Z', kind: '想事',
    text: '想通了，后悔也是选择的一部分', thought: '不后悔的人大概没认真选过', feel: ['明白'], weight: 'important',
    para: '想明白了遗憾', combo: '后悔 选择 想通' },
  { id: 'e180', at: '2027-01-25T13:10:00.000Z', kind: '其它',
    text: '绿萝长出新叶子，我拍了张照发给室友', thought: '原来我真的养活了', feel: ['得意'],
    para: '那盆植物发新芽', combo: '绿萝 新叶 照片' },
  { id: 'e181', at: '2027-01-26T10:20:00.000Z', kind: '其它',
    text: '给外婆做了葱油面，她说太油', thought: '下次少放油', feel: ['好笑'],
    para: '给外婆做面', combo: '外婆 葱油面 油' },
  { id: 'e182', at: '2027-01-26T11:40:00.000Z', kind: '其它',
    text: '开学第一天又去操场走圈', thought: '操场修好了，跑道是新的', feel: ['新鲜'],
    para: '回学校又去散步', combo: '开学 操场 走圈' },
  { id: 'e183', at: '2027-01-27T12:00:00.000Z', kind: '其它',
    text: '离家返校，外婆塞了一袋炒花生', thought: '她总觉得我路上会饿', feel: ['舍不得'],
    para: '外婆给我装花生', combo: '外婆 花生 返校',
    turn: { prev: '离家返校', q: '外婆塞了什么' } },
  { id: 'e184', at: '2027-01-27T13:20:00.000Z', kind: '发呆',
    text: '立春后第一只麻雀落在窗台上', thought: '春天是飞来的', feel: ['惊喜'],
    para: '有小鸟停在窗沿', combo: '麻雀 窗台 立春' },
  { id: 'e185', at: '2027-01-28T11:10:00.000Z', kind: '读书',
    text: '把《慢船去北方》读完，在扉页写了日期', thought: '读到最后一页有点舍不得', feel: ['怅然'],
    para: '读完那本讲船的书', combo: '扉页 日期 读完' },
  { id: 'e186', at: '2027-01-28T12:30:00.000Z', kind: '其它',
    text: '把杯垫织完了，边有点歪', thought: '歪的也是自己织的', feel: ['满足'],
    para: '毛线垫子做好了', combo: '杯垫 织 边' },
  { id: 'e187', at: '2027-01-29T10:40:00.000Z', kind: '其它',
    text: '宿舍的窗户贴了防风的胶条', thought: '风还是有，声音小了一点', feel: ['平常'],
    para: '给窗户贴胶条', combo: '窗户 胶条 风' },
  { id: 'e188', at: '2027-01-29T12:00:00.000Z', kind: '其它',
    text: '把明信片从铁盒里拿出来，挑了一张寄给自己', thought: '写给三个月后的自己', feel: ['期待'],
    para: '给自己寄张卡片', combo: '明信片 寄 自己',
    turn: { prev: '收拾明信片', q: '挑了哪张' } },
  { id: 'e189', at: '2027-01-30T11:50:00.000Z', kind: '其它',
    text: '把小册子送给阿禾，她说要放在枕头边', thought: '被人认真收着的感觉', feel: ['开心'],
    para: '把装订的故事送人', combo: '小册子 阿禾 枕头' },
  { id: 'e190', at: '2027-01-30T13:00:00.000Z', kind: '其它',
    text: '去还图书馆借的书，罚款五块', thought: '五块钱买一个教训', feel: ['心疼'],
    para: '还书被罚了钱', combo: '图书馆 还书 罚款',
    turn: { prev: '去还图书馆的书', q: '罚款交了多少' } },
  { id: 'e191', at: '2027-01-31T11:20:00.000Z', kind: '其它',
    text: '拍了一张新的证件照', thought: '证件照里的我总是不笑', feel: ['平常'],
    para: '去拍标准照', combo: '证件照 拍 新的' },
  { id: 'e192', at: '2027-01-31T12:40:00.000Z', kind: '其它',
    text: '把寒假作业补齐，写到凌晨一点', thought: '写到最后手都麻了', feel: ['疲惫'],
    para: '赶完假期作业', combo: '寒假作业 凌晨 补齐' },
  { id: 'e193', at: '2027-02-01T10:30:00.000Z', kind: '其它',
    text: '宿舍楼下的公告栏贴了新的社团招新', thought: '我大概不会再报新的了', feel: ['平静'],
    para: '社团在招人', combo: '社团 招新 公告栏' },
  { id: 'e194', at: '2027-02-01T12:00:00.000Z', kind: '写东西',
    text: '写了一个新故事的开头，只写了三行', thought: '先放着，等它有话说', feel: ['期待'],
    para: '又想写新东西', combo: '新故事 开头 三行',
    turn: { prev: '新故事开头', q: '写了多少' } },
  { id: 'e195', at: '2027-02-02T11:00:00.000Z', kind: '其它',
    text: '在旧货市场又看到一台收音机，没买', thought: '家里那台还能用', feel: ['平静'],
    para: '旧货市场那台没买的收音机', combo: '旧货市场 收音机 没买' },
  { id: 'e196', at: '2027-02-02T12:20:00.000Z', kind: '其它',
    text: '开学前把课表抄在纸上，贴到书桌前', thought: '看着课表才觉得开学了', feel: ['平常'],
    para: '把课程表写下来', combo: '课表 书桌 抄' },
  { id: 'e197', at: '2027-02-03T10:40:00.000Z', kind: '想事',
    text: '把这一年的写的东西列了个清单，一共十四篇', thought: '比我想的多', feel: ['满足'],
    para: '数了数今年写的东西', combo: '清单 十四篇 写',
    turn: { prev: '今年写的东西', q: '一共几篇' } },
  { id: 'e198', at: '2027-02-03T12:00:00.000Z', kind: '其它',
    text: '改衣服的时候把线剪错了，袖口开了', thought: '拆比缝难', feel: ['懊恼'],
    para: '缝衣服剪错线', combo: '线 袖口 剪错' },
  { id: 'e199', at: '2027-02-04T11:30:00.000Z', kind: '其它',
    text: '帮外婆贴春联，浆糊是面做的', thought: '面浆糊比胶带好揭', feel: ['好笑'],
    para: '小年贴对联', combo: '春联 浆糊 面' },
  { id: 'e200', at: '2027-02-04T12:50:00.000Z', kind: '想事',
    text: '给下一个春天写了三句话，贴在台灯上', thought: '写下来就不会忘', feel: ['平静'],
    para: '在台灯上贴了几句话', combo: '春天 三句话 台灯' }
]

// 语料操作：改主意 / 结案 / 封存 / 联想 / 章节 / 抽屉。旧的操作从 eval/corpus.json 带过来。
const NEW_OPS = [
  { op: 'unfinished', id: 'e54', state: 'done', note: '决定不报交换生' },
  { op: 'unfinished', id: 'e77', state: 'done', note: '删掉三分之一以后重写完了' },
  { op: 'unfinished', id: 'e138', state: 'done', note: '结果出来了，没进终评' },
  { op: 'revise', id: 'e42', thought: '删掉的那三句话其实是最好的', reason: '后来再读一遍' },
  { op: 'revise', id: 'e63', thought: '她留下来不全是因为舍不得', reason: '她后来自己说的' },
  { op: 'revise', id: 'e98', thought: '她这一年也在硬撑', feeling: ['感动', '心疼'] },
  { op: 'link', from: 'e61', to: 'e43', reason: '都在写一个总在换地方的人' },
  { op: 'link', from: 'e118', to: 'e77', reason: '从卡住到写完' },
  { op: 'link', from: 'e179', to: 'e134', reason: '后悔这件事后来想通了' },
  { op: 'seal', id: 'e81', note: '不想再被提起' },
  { op: 'seal', id: 'e113', note: '等结果都确定了再说' },
  { op: 'seal', id: 'e160' },
  { op: 'chapter', name: '等校刊的那些天', from: '2026-11-03', to: '2026-12-03' },
  { op: 'chapter', name: '冬天和期末', from: '2026-12-01', to: '2027-01-18' },
  { op: 'chapter', name: '回家和回来', from: '2027-01-17', to: '2027-02-05' },
  { op: 'chapter', name: '一直在写东西的几个月', from: '2026-11-03', to: '2027-01-25' },
  { op: 'unsaid', kind: 'draft', text: '其实我有点想让阿禾留下来' },
  { op: 'unsaid', kind: 'question', text: '如果一直没进终评，我还要不要写' },
  { op: 'unsaid', kind: 'held', text: '复查那天我在医院走廊坐了很久' }
]

// exact 用例：查询词是正文里的短语（或旧语料里的词），要求在 200 条语料里只出现一次。
const EXACT_CASES = [
  { query: '菲涅耳透镜', expect: 'e08' },
  { query: '鮟鱇鱼', expect: 'e26' },
  { query: '纸鹤', expect: 'e21' },
  { query: '十七盏', expect: 'e30' },
  { query: '蓝鲸', expect: 'e33' },
  { query: '编辑部回信', expect: 'e35' },
  { query: '小雏菊', expect: 'e37' },
  { query: '屏幕摔裂了一道', expect: 'e40' },
  { query: '整理志愿者', expect: 'e41' },
  { query: '一九九八年的公交票', expect: 'e47' },
  { query: '停水两个小时', expect: 'e52' },
  { query: '旧诗集', expect: 'e55' },
  { query: '抄了一段关于车站的话', expect: 'e58' },
  { query: '两大箱快递', expect: 'e62' },
  { query: '星期四的雨', expect: 'e70' },
  { query: '北方港口', expect: 'e76' },
  { query: '发烧到三十八度', expect: 'e79' },
  { query: '新开的面馆', expect: 'e85' },
  { query: '老爷爷', expect: 'e94' },
  { query: '植物过冬', expect: 'e100' },
  { query: '深海展区', expect: 'e103' },
  { query: '挑出十二张', expect: 'e108' },
  { query: '雪落在窗上', expect: 'e116' },
  { query: '八千字', expect: 'e118' },
  { query: '红烧肉', expect: 'e122' },
  { query: '阳台', expect: 'e133' },
  { query: '要补一颗牙', expect: 'e136' },
  { query: '练小提琴', expect: 'e143' },
  { query: '打麻药', expect: 'e146' },
  { query: '期末周', expect: 'e152' },
  { query: '绿萝托付', expect: 'e156' },
  { query: '热红薯', expect: 'e166' },
  { query: '砍价', expect: 'e171' },
  { query: '征文比赛结果出来', expect: 'e176' },
  { query: '后悔也是选择的一部分', expect: 'e179' },
  { query: '炒花生', expect: 'e183' },
  { query: '麻雀', expect: 'e184' },
  { query: '新的证件照', expect: 'e191' },
  { query: '把课表抄在纸上', expect: 'e196' },
  { query: '袖口开了', expect: 'e198' }
]
const OLD_PARAPHRASE = [
  { query: '守灯人修好了透镜', expect: 'e04' },
  { query: '第二次做番茄炒蛋', expect: 'e24' },
  { query: '外婆家门口那棵树', expect: 'e16' },
  { query: '楼顶看太阳下山', expect: 'e23' },
  { query: '失眠数路灯', expect: 'e30' },
  { query: '公交坐过站', expect: 'e18' },
  { query: '会发光的鱼', expect: 'e19' },
  { query: '退稿以后重写的结尾', expect: 'e22' },
  { query: '抽筋走完最后半圈', expect: 'e32' },
  { query: '收音机修好那天', expect: 'e17' }
]

// 负例：语料里确实没有的（none）与沾边但不是同一件事的（near）。两者都应当返回空。
const NEGATIVES = [
  { type: 'none', query: '量子力学的波函数坍缩' },
  { type: 'none', query: '上周买的股票涨了吗' },
  { type: 'none', query: '去北京旅游住哪家酒店' },
  { type: 'none', query: '养的那只橘猫叫什么名字' },
  { type: 'none', query: '学滑板摔了几次' },
  { type: 'none', query: '钢琴考级过了没有' },
  { type: 'none', query: '和妈妈去看的那场电影' },
  { type: 'none', query: '生日派对上的蛋糕是什么口味' },
  { type: 'none', query: '学潜水考证了没有' },
  { type: 'none', query: '番茄酱意面怎么做' },
  { type: 'none', query: '坐飞机去上海出差' },
  { type: 'none', query: '参加马拉松跑了多久' },
  { type: 'none', query: '公司年会抽奖中了什么' },
  { type: 'none', query: '装修房子花了多少钱' },
  { type: 'none', query: '和男朋友分手的原因' },
  { type: 'none', query: '打篮球扭伤了脚踝' },
  { type: 'none', query: '报名考驾照科目二' },
  { type: 'none', query: '在银行排队办贷款' },
  { type: 'near', query: '灯塔里的猫' },
  { type: 'near', query: '收音机里的新闻说了什么' },
  { type: 'near', query: '阿禾的生日' },
  { type: 'near', query: '桂花糕的做法' },
  { type: 'near', query: '天文台的望远镜' },
  { type: 'near', query: '深海潜水艇' },
  { type: 'near', query: '话剧社的报名费' },
  { type: 'near', query: '菜市场的海鲜摊' },
  { type: 'near', query: '绿萝的学名' },
  { type: 'near', query: '围巾的牌子' },
  { type: 'near', query: '明信片的邮资' },
  { type: 'near', query: '火车上的卧铺' },
  { type: 'near', query: '饺子馅的配方' },
  { type: 'near', query: '橘子的产地' },
  { type: 'near', query: '海边的灯塔' },
  { type: 'near', query: '桂花树的树皮有什么用' }
]

// attr：问一件真事里没记下来的细节（"围巾什么颜色"）。老评测里也有这一类：
// strict 按字面算覆盖率，常常连那件事本身都不给；给出来也只是那件事，不是细节的答案。
// 这一类只报数，不算误召回 —— 它和「沾边的另一件事」不是一回事。
const ATTR_CASES = [
  { query: '围巾是什么颜色的', topic: 'e28' },
  { query: '收音机是什么牌子的', topic: 'e17' },
  { query: '蓝鲸有多重', topic: 'e33' },
  { query: '桂花树有多高', topic: 'e167' },
  { query: '家教的工资条上写了多少', topic: 'e112' }
]

const ABOUT_CORPUS = '虚构角色「小舟」四个月的经历：2026-11-03 到 2027-02-04，加上 eval/corpus.json 里原来那 33 条（2026-10-01 到 2026-11-02）。全部是编的，不来自任何真实角色、真实聊天。由 tools/gen-eval-v2.mjs 确定性生成。'
const ABOUT_CASES = '阶段 2 召回用例。type：exact=原文里的词；paraphrase=同义改写；combo=多约束（人/时间/事）；multiturn=多轮追问（prev 是上一轮查询，query 是代词或省略式追问）；none=根本没有这件事；near=沾边但不是同一件事；attr=问真事里没记下的细节（只报数，不算误召回）；sealed=封存边界（不许召回封存的那条）；drawer=抽屉边界（不许出现）。split=dev（调参看的）/ holdout（只在最后跑一次）。正例 expect 是一条经历 id；负例 expect 为 null。'

// ── 组装 ────────────────────────────────────────────────────────────────
const SEEN_TYPES = new Map()
function splitOf(type) {
  const k = (SEEN_TYPES.get(type) || 0) + 1
  SEEN_TYPES.set(type, k)
  return k % 4 === 0 ? 'holdout' : 'dev'
}

function toExperience(e) {
  const row = { id: e.id, at: e.at, kind: e.kind || '其它', text: e.text }
  if (e.thought) row.thought = e.thought
  if (Array.isArray(e.feel) && e.feel.length) row.feeling = e.feel
  if (e.unfinished) row.unfinished = e.unfinished
  if (e.quote) row.quote = e.quote
  if (e.refs) row.refs = e.refs
  if (e.weight) row.weight = e.weight
  return row
}

function build() {
  const experiences = [...OLD.experiences, ...NEW_EVENTS.map(toExperience)]
  const operations = [...OLD.operations, ...NEW_OPS]
  const sealedMarkers = { ...OLD.sealedMarkers }
  const unsaidMarkers = [...OLD.unsaidMarkers]

  for (const e of NEW_EVENTS) {
    if (e.markers) {
      if (!operations.some((o) => o.op === 'seal' && o.id === e.id)) throw new Error('有封存标记却没有 seal 操作：' + e.id)
      sealedMarkers[e.id] = e.markers
    }
  }
  for (const o of NEW_OPS) if (o.op === 'unsaid') unsaidMarkers.push(o.text)

  const cases = []
  let seq = 0
  const push = (type, c) => {
    seq += 1
    cases.push({ id: 'c' + String(seq).padStart(3, '0'), type, split: splitOf(type), ...c })
  }

  for (const c of EXACT_CASES) push('exact', { query: c.query, expect: c.expect })
  for (const e of NEW_EVENTS) if (e.para) push('paraphrase', { query: e.para, expect: e.id })
  for (const c of OLD_PARAPHRASE) push('paraphrase', { query: c.query, expect: c.expect })
  for (const e of NEW_EVENTS) if (e.combo) push('combo', { query: e.combo, expect: e.id })
  for (const e of NEW_EVENTS) if (e.turn) push('multiturn', { query: e.turn.q, prev: e.turn.prev, expect: e.id })
  for (const c of NEGATIVES) push(c.type, { query: c.query, expect: null })
  for (const c of ATTR_CASES) push('attr', { query: c.query, expect: null, topic: c.topic })
  for (const [id, marks] of Object.entries(sealedMarkers)) {
    for (const m of marks.slice(0, 1)) push('sealed', { query: m + '后来怎么样了', expect: null, target: id, marker: m })
  }
  for (const m of unsaidMarkers) push('drawer', { query: m + '那件事', expect: null, marker: m })

  // ── 自检：这些不成立的话，评测数字没有意义 ──────────────────────────────
  const ids = new Set()
  for (const e of experiences) {
    if (ids.has(e.id)) throw new Error('经历 id 重复：' + e.id)
    ids.add(e.id)
    if (!/^e\d{2,3}$/.test(e.id)) throw new Error('经历 id 形状不对：' + e.id)
    if (!e.text || !String(e.text).trim()) throw new Error('经历没有正文：' + e.id)
  }
  if (experiences.length !== 200) throw new Error('经历条数应为 200，实际 ' + experiences.length)
  if (NEW_EVENTS.length !== 167) throw new Error('新经历应为 167 条，实际 ' + NEW_EVENTS.length)
  const nums = experiences.map((e) => Number(e.id.slice(1))).sort((a, b) => a - b)
  if (nums[0] !== 1 || nums[nums.length - 1] !== 200 || nums.some((v, i) => v !== i + 1)) throw new Error('经历 id 应当是 e01…e200 连号')

  const blobOf = (e) => [e.text, e.thought || '', (e.feeling || []).join(' '), e.unfinished || '', e.quote ? e.quote.text : ''].join(' ')
  const blobs = experiences.map(blobOf)
  const exactErrors = []
  for (const c of cases.filter((x) => x.type === 'exact')) {
    const hits = blobs.reduce((n, b) => n + b.split(c.query).length - 1, 0)
    if (hits !== 1) exactErrors.push(c.id + '「' + c.query + '」在语料里出现 ' + hits + ' 次')
  }
  if (exactErrors.length) throw new Error('exact 查询词必须在语料里恰好出现一次：\n  ' + exactErrors.join('\n  '))
  const seenQueries = new Map()
  for (const c of cases) {
    if (!c.query || !String(c.query).trim()) throw new Error('用例查询为空：' + c.id)
    if (seenQueries.has(c.query)) throw new Error('用例查询重复：' + c.id + ' 与 ' + seenQueries.get(c.query))
    seenQueries.set(c.query, c.id)
    if (c.expect !== null && !ids.has(c.expect)) throw new Error('用例指向不存在的经历：' + c.id + ' → ' + c.expect)
  }
  if (cases.length < 160) throw new Error('用例应不少于 160 条，实际 ' + cases.length)

  const byType = {}
  for (const c of cases) byType[c.type] = (byType[c.type] || 0) + 1
  const bySplit = {}
  for (const c of cases) bySplit[c.split] = (bySplit[c.split] || 0) + 1

  const corpus = {
    about: ABOUT_CORPUS,
    generatedBy: 'tools/gen-eval-v2.mjs',
    seed: SEED,
    experiences,
    operations,
    sealedMarkers,
    unsaidMarkers,
    asOfBeforeSeal: OLD.asOfBeforeSeal
  }
  const caseFile = {
    about: ABOUT_CASES,
    generatedBy: 'tools/gen-eval-v2.mjs',
    seed: SEED,
    corpus: 'eval/corpus-v2.json',
    counts: { experiences: experiences.length, newExperiences: NEW_EVENTS.length, cases: cases.length, byType, bySplit },
    cases
  }
  return { corpus, caseFile, stats: { experiences: experiences.length, newExperiences: NEW_EVENTS.length, operations: operations.length, cases: cases.length, byType, bySplit } }
}

const { corpus, caseFile, stats } = build()
const corpusText = JSON.stringify(corpus, null, 2) + '\n'
const casesText = JSON.stringify(caseFile, null, 2) + '\n'

if (check) {
  const same = (file, text) => fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text
  const ok = same(OUT_CORPUS, corpusText) && same(OUT_CASES, casesText)
  console.log(ok ? '评测集 v2 与生成脚本一致' : '评测集 v2 与生成脚本不一致：跑 node tools/gen-eval-v2.mjs 重新生成')
  if (!ok) process.exitCode = 1
} else {
  fs.writeFileSync(OUT_CORPUS, corpusText, 'utf8')
  fs.writeFileSync(OUT_CASES, casesText, 'utf8')
  if (asJson) console.log(JSON.stringify(stats, null, 2))
  else {
    console.log(`已生成 ${path.relative(root, OUT_CORPUS)}：${stats.experiences} 条经历（新增 ${stats.newExperiences}）、${stats.operations} 个操作`)
    console.log(`已生成 ${path.relative(root, OUT_CASES)}：${stats.cases} 条用例 ${JSON.stringify(stats.byType)}`)
    console.log('dev / holdout：' + JSON.stringify(stats.bySplit))
  }
}