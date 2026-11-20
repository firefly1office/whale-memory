/**
 * 把口语里的时间说法翻成时间窗口：「前几天」「上周三」「上个月」「昨天晚上」。
 *
 * 为什么要它：她问「前几天那个事」时，字面匹配找不到任何东西——那句话里没有具体日期。
 * 先翻成 [from, to)，再去检索，才可能命中。
 *
 * 纯函数，无 IO。拿不准就返回 null（宁可不过滤，也不乱过滤）。
 */

const DAY = 86400000;

function toMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1e11 ? n : n * 1000;
}

function localDay(ms, offset = 0, hour = 0) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, hour).getTime();
}

function startOfWeek(ms) {
  const d = new Date(ms);
  const offset = (d.getDay() + 6) % 7;   // 周一为一周开始
  return localDay(ms, -offset);
}

function startOfMonth(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (text === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(text)) return 10 + CN_NUM[text[1]];
  if (/^[一二两三四五六七八九]十$/.test(text)) return CN_NUM[text[0]] * 10;
  if (/^[一二两三四五六七八九]十[一二三四五六七八九]$/.test(text)) return CN_NUM[text[0]] * 10 + CN_NUM[text[2]];
  return CN_NUM[text] || 0;
}

/**
 * 解析口语时间窗口。
 * @param {string} text 她收到的那句话
 * @param {object} [options] {now}
 * @returns {{from:number,to:number,label:string,kind:string}|null}
 */
export function parseRelativeWindow(text, { now = Date.now() } = {}) {
  const q = String(text || '');
  const n = toMs(now) || Date.now();
  if (!q.trim()) return null;
  const today = localDay(n);

  // 数量要先于「前天」匹配，否则「三天前天气」会在量词边界处被截断。
  const quantity = /([0-9]+|[一二两三四五六七八九十]+)\s*(天|日|个?周|个?星期|个?礼拜)(?:以|之)?前/.exec(q);
  if (quantity) {
    const k = cnNumber(quantity[1]);
    const days = quantity[2] === '天' || quantity[2] === '日';
    if (!k || k > (days ? 60 : 12)) return null;
    const from = days ? localDay(today, -k) : localDay(startOfWeek(n), -7 * k);
    return { from, to: localDay(from, days ? 1 : 7), label: days ? `${k} 天前` : `${k} 周前`, kind: days ? 'n-days' : 'n-weeks' };
  }

  if (/前几天|前两天|几天前|前些天|前阵子|这些天|这几天|这两天|近几天/.test(q)) {
    return { from: localDay(today, -4), to: localDay(today, 1), label: '前几天', kind: 'fuzzy-days' };
  }

  const day = /(大前天|前天|昨天|今天|昨晚|今晚|今早)(?:的?\s*(上午|早上|中午|下午|傍晚|晚上|夜里|半夜))?/.exec(q);
  if (day) {
    const label = { 昨晚: '昨天', 今晚: '今天', 今早: '今天' }[day[1]] || day[1];
    const offset = { 大前天: -3, 前天: -2, 昨天: -1, 今天: 0 }[label];
    const base = localDay(today, offset);
    const part = { 昨晚: '晚上', 今晚: '晚上', 今早: '早上' }[day[1]] || day[2];
    if (!part) return { from: base, to: localDay(base, 1), label, kind: 'day' };
    const [start, end] = { 上午: [6, 12], 早上: [6, 11], 中午: [11, 13], 下午: [13, 17], 傍晚: [17, 19], 晚上: [18, 22], 夜里: [22, 24], 半夜: [23, 26] }[part];
    return { from: localDay(base, 0, start), to: localDay(base, 0, end), label: label + part, kind: 'part-of-day' };
  }
  if (/刚刚|刚才/.test(q)) {
    return { from: n - 3600000, to: n + 60000, label: '刚刚', kind: 'recent' };
  }

  // 无「上/这/本」等限定词时，只有紧跟星期几才足以定位。
  const week = /(?:(上上|下下|上|下|这|本)个?|(?<![每隔个0-9一二两三四五六七八九十])(?=(?:周|星期|礼拜)[一二三四五六日天]))(?:周|星期|礼拜)(?!末|年|围|堂|杰伦)([一二三四五六日天])?((?:以|之)前)?/.exec(q);
  if (week) {
    const which = week[1] || '这';
    if (which.startsWith('下')) return null;
    const shift = which === '上上' ? -14 : which === '上' ? -7 : 0;
    const weekday = week[2];
    const offset = weekday ? { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }[weekday] : 0;
    const from = localDay(startOfWeek(n), shift + offset);
    const label = which + '周' + (weekday || '');
    if (week[3]) return { from: 0, to: from, label: label + week[3], kind: 'older' };
    return { from, to: localDay(from, weekday ? 1 : 7), label, kind: weekday ? 'weekday' : 'week' };
  }

  const month = /(上上|上|这|本)个?月(?!亮|光|饼|份)((?:以|之)前)?/.exec(q);
  if (month) {
    const d = new Date(n);
    const shift = month[1] === '上上' ? -2 : month[1] === '上' ? -1 : 0;
    const from = new Date(d.getFullYear(), d.getMonth() + shift, 1).getTime();
    const label = month[1] + '个月';
    if (month[2]) return { from: 0, to: from, label: label + month[2], kind: 'older' };
    return { from, to: new Date(d.getFullYear(), d.getMonth() + shift + 1, 1).getTime(), label, kind: 'month' };
  }

  if (/最近|近期/.test(q)) {
    return { from: localDay(today, -3), to: localDay(today, 1), label: '最近', kind: 'recent' };
  }
  if (/更早/.test(q)) {
    return { from: startOfMonth(n) - 90 * DAY, to: startOfMonth(n), label: '上个月以前', kind: 'older' };
  }
  return null;
}

/** 是否落在窗口里。窗口为 null 时一律算在内（不过滤）。 */
export function inWindow(ts, window) {
  if (!window) return true;
  const t = toMs(ts);
  if (!t) return false;
  return t >= window.from && t < window.to;
}