// 口语时间窗口：能不能翻对、边界在哪。
import assert from 'node:assert/strict'
import test from 'node:test'
import { inWindow, parseRelativeWindow } from '../packages/core/lib/relative-window.js'

// 基准：2026-11-20（周五）20:30 本地
const NOW = new Date(2026, 10, 20, 20, 30, 0).getTime()
const w = (text) => parseRelativeWindow(text, { now: NOW })
const dayStart = (y, m, d) => new Date(y, m - 1, d).getTime()
const DAY = 86400000

test('今天 / 昨天 / 前天', () => {
  assert.equal(w('今天那个事').from, dayStart(2026, 11, 20))
  assert.equal(w('昨天说的').from, dayStart(2026, 11, 19))
  assert.equal(w('昨天说的').to, dayStart(2026, 11, 20))
  assert.equal(w('前天那个').from, dayStart(2026, 11, 18))
})

test('昨天 + 晚上：只圈晚上', () => {
  const win = w('昨天晚上那个')
  assert.equal(win.label, '昨天晚上')
  assert.equal(win.from, dayStart(2026, 11, 19) + 18 * 3600000)
  assert.equal(win.to, dayStart(2026, 11, 19) + 22 * 3600000)
})

test('前几天：宽窗口，从现在往前 4 天', () => {
  const win = w('前几天说的那个方案')
  assert.equal(win.kind, 'fuzzy-days')
  assert.equal(win.from, dayStart(2026, 11, 20) - 4 * DAY)
})

test('上周 / 上周三', () => {
  const week = w('上周聊的')
  assert.equal(week.from, dayStart(2026, 11, 9))      // 本周一 = 11-16，上周一 = 11-09
  const wed = w('上周三')
  assert.equal(wed.from, dayStart(2026, 11, 11))
  assert.equal(wed.to, dayStart(2026, 11, 12))
})

test('这个月 / 上个月', () => {
  assert.equal(w('这个月').from, dayStart(2026, 11, 1))
  assert.equal(w('上个月').from, dayStart(2026, 10, 1))
  assert.equal(w('上个月').to, dayStart(2026, 11, 1))
})

test('N 天前（含中文数字）', () => {
  assert.equal(w('3 天前').from, dayStart(2026, 11, 17))
  assert.equal(w('三天前').from, dayStart(2026, 11, 17))
  assert.equal(w('十天前').from, dayStart(2026, 11, 10))
})

test('N 周前', () => {
  assert.equal(w('两周前').from, dayStart(2026, 11, 9) - 7 * DAY)
})

test('刚刚', () => {
  const win = w('刚刚那个')
  assert.equal(win.kind, 'recent')
  assert.ok(win.from < NOW && win.to >= NOW)
})

test('没有时间说法：返回 null', () => {
  assert.equal(w('这个方案好不好'), null)
  assert.equal(w('随便聊聊'), null)
  assert.equal(w('今天天气怎么样').label, '今天')   // 含「今天」就算今天
})

test('窗口判定：边界含头不含尾', () => {
  const win = { from: dayStart(2026, 11, 19), to: dayStart(2026, 11, 20), label: '昨天', kind: 'day' }
  assert.equal(inWindow(dayStart(2026, 11, 19), win), true)
  assert.equal(inWindow(dayStart(2026, 11, 20) - 1, win), true)
  assert.equal(inWindow(dayStart(2026, 11, 20), win), false)
  assert.equal(inWindow(null, win), false)
})

test('窗口为 null：一律算在内', () => {
  assert.equal(inWindow(123456, null), true)
})

test('秒级时间戳也能判', () => {
  const win = { from: dayStart(2026, 11, 19), to: dayStart(2026, 11, 20), label: '昨天', kind: 'day' }
  assert.equal(inWindow(Math.floor((dayStart(2026, 11, 19) + 3600000) / 1000), win), true)
})

for (const phrase of ['周末', '周年', '周围', '周杰伦', '每周', '每周三', '礼拜堂', '下周三', '下个星期三', '这个月亮好圆', '这个月光很亮', '这个月饼好吃', '这个月份']) {
  test(phrase + ' 不应触发回忆窗口', () => assert.equal(w(phrase), null))
}

test('没有周前缀时只接受明确的星期几', () => {
  for (const phrase of ['周三', '星期三', '礼拜三']) {
    assert.equal(w(phrase).from, dayStart(2026, 11, 18))
  }
  assert.equal(w('上个星期').from, dayStart(2026, 11, 9))
})

for (const phrase of ['大前天', '三天前天气很好']) {
  test(phrase + ' 定位整整三天前', () => {
    assert.equal(w(phrase).from, dayStart(2026, 11, 17))
    assert.equal(w(phrase).to, dayStart(2026, 11, 18))
  })
}

for (const [phrase, day, start, end] of [['昨晚', 19, 18, 22], ['今晚', 20, 18, 22], ['今早', 20, 6, 11]]) {
  test(phrase + ' 限定本地时段', () => {
    assert.equal(w(phrase).kind, 'part-of-day')
    assert.equal(w(phrase).from, new Date(2026, 10, day, start).getTime())
    assert.equal(w(phrase).to, new Date(2026, 10, day, end).getTime())
  })
}
for (const phrase of ['前两天', '几天前']) {
  test(phrase + ' 沿用前几天的宽窗口', () => assert.deepEqual(w(phrase), w('前几天')))
}

for (const [phrase, boundary] of [['上周以前', dayStart(2026, 11, 9)], ['上个月以前', dayStart(2026, 10, 1)]]) {
  test(phrase + ' 在所指周期起点截止', () => {
    const win = w(phrase)
    assert.equal(win.kind, 'older')
    assert.equal(win.to, boundary)
    assert.equal(inWindow(boundary - 1, win), true)
    assert.equal(inWindow(boundary, win), false)
  })
}
