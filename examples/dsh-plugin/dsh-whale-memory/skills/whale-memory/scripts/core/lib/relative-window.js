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

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfWeek(ms) {
  const dayStart = startOfDay(ms);
  const d = new Date(dayStart);
  const offset = (d.getDay() + 6) % 7;   // 周一为一周开始
  return dayStart - offset * DAY;
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
  const today = startOfDay(n);

  // 具体到点的时间段：今天早上 / 昨天晚上 / 昨天下午
  const partOfDay = (base, label) => {
    const m = /(上午|早上|中午|下午|傍晚|晚上|夜里|半夜)/.exec(q);
    if (!m) return null;
    const from = { 上午: 6, 早上: 6, 中午: 11, 下午: 13, 傍晚: 17, 晚上: 18, 夜里: 22, 半夜: 23 }[m[1]];
    const to = { 上午: 12, 早上: 11, 中午: 13, 下午: 17, 傍晚: 19, 晚上: 22, 夜里: 24, 半夜: 26 }[m[1]];
    return { from: base + from * 3600000, to: base + to * 3600000, label: `${label}${m[1]}`, kind: 'part-of-day' };
  };

  if (/前天/.test(q)) {
    const base = today - 2 * DAY;
    return partOfDay(base, '前天') || { from: base, to: base + DAY, label: '前天', kind: 'day' };
  }
  if (/昨天|昨晚/.test(q)) {
    const base = today - DAY;
    return partOfDay(base, '昨天') || { from: base, to: base + DAY, label: '昨天', kind: 'day' };
  }
  if (/今天|今晚|今早/.test(q)) {
    return partOfDay(today, '今天') || { from: today, to: today + DAY, label: '今天', kind: 'day' };
  }
  if (/刚刚|刚才|刚才那会/.test(q)) {
    return { from: n - 3600000, to: n + 60000, label: '刚刚', kind: 'recent' };
  }

  // N 天前 / N 周前 / N 个月前（口语常带「大概」「差不多」）
  const nDays = /([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:天|日)(?:前|以前|之前)/.exec(q);
  if (nDays) {
    const k = cnNumber(nDays[1]);
    if (k > 0 && k <= 60) {
      const from = today - k * DAY;
      return { from, to: from + DAY, label: `${k} 天前`, kind: 'n-days' };
    }
  }
  const nWeeks = /([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:个)?(?:周|星期|礼拜)(?:前|以前|之前)/.exec(q);
  if (nWeeks) {
    const k = cnNumber(nWeeks[1]);
    if (k > 0 && k <= 12) {
      const from = startOfWeek(n) - k * 7 * DAY;
      return { from, to: from + 7 * DAY, label: `${k} 周前`, kind: 'n-weeks' };
    }
  }

  // 上周 / 上上周 / 这周 / 本周
  const weekMatch = /(?<![0-9一二两三四五六七八九十])(上上|上|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天])?/.exec(q);
  if (weekMatch) {
    const which = weekMatch[1] || '这';
    const target = weekMatch[2];
    const thisWeek = startOfWeek(n);
    const base = which === '上上' ? thisWeek - 14 * DAY : which === '上' ? thisWeek - 7 * DAY : thisWeek;
    if (target) {
      const idx = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }[target];
      const from = base + idx * DAY;
      return { from, to: from + DAY, label: `${which}周${target}`, kind: 'weekday' };
    }
    return { from: base, to: base + 7 * DAY, label: `${which}周`, kind: 'week' };
  }

  // 上个月 / 这个月 / 上上个月
  if (/(上上|上|这|本)(?:个)?月/.test(q)) {
    const m = /(上上|上|这|本)(?:个)?月/.exec(q);
    const d = new Date(n);
    const shift = m[1] === '上上' ? -2 : m[1] === '上' ? -1 : 0;
    const from = new Date(d.getFullYear(), d.getMonth() + shift, 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + shift + 1, 1).getTime();
    return { from, to, label: `${m[1]}个月`, kind: 'month' };
  }

  // 「前几天」「前阵子」「这几天」「最近」：给一个宽窗口，宁可宽一点
  if (/前几天|前些天|前阵子|这些天|这两天|近几天/.test(q)) {
    return { from: today - 4 * DAY, to: today + DAY, label: '前几天', kind: 'fuzzy-days' };
  }
  if (/上个星期|上周以?前/.test(q)) {
    const from = startOfWeek(n) - 7 * DAY;
    return { from, to: startOfWeek(n), label: '上周', kind: 'week' };
  }
  if (/最近|近期/.test(q)) {
    return { from: today - 3 * DAY, to: today + DAY, label: '最近', kind: 'recent' };
  }
  if (/上个月以?前|更早/.test(q)) {
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