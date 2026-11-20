// 人话时间：口语说法、边界、跨天。
import assert from 'node:assert/strict'
import test from 'node:test'
import { dayDiff, humanTime, timeAgo } from '../packages/core/lib/time-sense.js'

// 固定一个本地时间点做基准：2026-11-20 20:30 本地
const NOW = new Date(2026, 10, 20, 20, 30, 0).getTime()
const at = (day, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute, 0).getTime()

test('刚刚', () => {
  assert.equal(humanTime(NOW - 30 * 1000, { now: NOW }), '刚刚')
  assert.equal(timeAgo(NOW - 30 * 1000, { now: NOW }), '刚刚')
})

test('分钟与小时', () => {
  assert.equal(humanTime(NOW - 12 * 60000, { now: NOW }), '12 分钟前')
  assert.equal(timeAgo(NOW - 13 * 3600000, { now: NOW }), '13 小时前')
})

test('今天 / 昨天 / 前天 带时刻', () => {
  assert.equal(humanTime(at(20, 9, 12), { now: NOW }), '今天 09:12')
  assert.equal(humanTime(at(19, 20, 30), { now: NOW }), '昨天 20:30')
  assert.equal(humanTime(at(18, 18, 40), { now: NOW }), '前天 18:40')
})

test('3–6 天前用天数', () => {
  assert.equal(humanTime(at(17), { now: NOW }), '3 天前')
  assert.equal(humanTime(at(14), { now: NOW }), '6 天前')
})

test('相隔七天且落在上一日历周时说「上周X」', () => {
  assert.equal(humanTime(at(13), { now: NOW }), '上周五')   // 2026-11-13 是周五
})

test('两周到一个月说「N 周前」', () => {
  assert.equal(humanTime(at(6), { now: NOW }), '2 周前')
})

test('一个月到一年说「个月」', () => {
  const ts = new Date(2026, 8, 20, 12, 0, 0).getTime()
  assert.equal(humanTime(ts, { now: NOW }), '2 个月前')
})

test('更久给日期', () => {
  const ts = new Date(2025, 7, 1, 12, 0, 0).getTime()
  assert.equal(humanTime(ts, { now: NOW }), '2025-08-01')
})

test('未来的时间不编「之后」', () => {
  const ts = NOW + 2 * 3600000
  assert.equal(humanTime(ts, { now: NOW }), '22:30')
})

test('秒级时间戳也能认', () => {
  const sec = Math.floor(at(19, 20, 30) / 1000)
  assert.equal(humanTime(sec, { now: NOW }), '昨天 20:30')
})

test('空值与 0 返回空串', () => {
  assert.equal(humanTime(0, { now: NOW }), '')
  assert.equal(humanTime(null, { now: NOW }), '')
  assert.equal(timeAgo(0, { now: NOW }), '')
})

test('dayDiff：本地日历日差', () => {
  assert.equal(dayDiff(at(20, 0, 1), NOW), 0)
  assert.equal(dayDiff(at(19, 23, 59), NOW), 1)
  assert.equal(dayDiff(at(18, 0, 0), NOW), 2)
})

test('周一回看八天前的周日已跨过上周；跨年也以周一为界', () => {
  const monday = new Date(2026, 0, 5, 12).getTime()
  assert.equal(humanTime(new Date(2025, 11, 28, 12).getTime(), { now: monday }), '8 天前')
  assert.equal(humanTime(new Date(2025, 11, 29, 12).getTime(), { now: monday }), '上周一')
  assert.equal(humanTime(at(9), { now: NOW }), '上周一')
  assert.equal(humanTime(at(8), { now: NOW }), '12 天前')
})

test('满三十天后用日历月差，覆盖同月、跨年和短月', () => {
  const noon = (year, month, day) => new Date(year, month - 1, day, 12).getTime()
  assert.equal(humanTime(noon(2026, 1, 1), { now: noon(2026, 1, 31) }), '4 周前')
  assert.equal(humanTime(noon(2025, 12, 21), { now: noon(2026, 1, 31) }), '上个月')
  assert.equal(humanTime(noon(2026, 1, 16), { now: noon(2026, 3, 1) }), '2 个月前')
})

test('不足整分或整点不向上进位', () => {
  const late = new Date(2026, 10, 20, 23, 59).getTime()
  const ts = late - 59.6 * 60000
  assert.equal(humanTime(ts, { now: late }), '59 分钟前')
  assert.equal(timeAgo(ts, { now: late }), '59 分钟前')
  assert.equal(timeAgo(at(20, 0), { now: late }), '23 小时前')
})
