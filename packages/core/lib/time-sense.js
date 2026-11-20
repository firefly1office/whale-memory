/**
 * 人话时间：把时间戳说成她该听见的样子——「昨天 20:30」「上周三」「3 天前」，而不是「11-20 20:30」。
 *
 * 为什么要单独一层：她答「前几天那个事」时，需要的是「这属于哪一天」，而不是一个日期字符串。
 * 纯函数，无 IO。
 */

function toMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1e11 ? n : n * 1000;   // 秒 → 毫秒
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function clock(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 本地日历日差：0=今天，1=昨天，2=前天…… */
export function dayDiff(ts, now = Date.now()) {
  const a = toMs(ts);
  const b = toMs(now);
  if (!a || !b) return null;
  const da = new Date(a);
  const db = new Date(b);
  const startA = new Date(da.getFullYear(), da.getMonth(), da.getDate()).getTime();
  const startB = new Date(db.getFullYear(), db.getMonth(), db.getDate()).getTime();
  return Math.round((startB - startA) / 86400000);
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 「人话」时间。
 * @param {number} ts 时间戳（秒或毫秒）
 * @param {object} [options] {now}
 * @returns {string} 例：刚刚 / 12 分钟前 / 今天 09:12 / 昨天 20:30 / 前天 18:40 / 3 天前 / 上周三 / 3 周前 / 2 个月前 / 2025-08-01
 */
export function humanTime(ts, { now = Date.now() } = {}) {
  const t = toMs(ts);
  const n = toMs(now) || Date.now();
  if (!t) return '';
  const diff = n - t;
  if (diff < 0) return clock(new Date(t));          // 未来的时间：只给时刻，不编「之后」
  const minutes = diff / 60000;
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${Math.floor(minutes)} 分钟前`;

  const days = dayDiff(t, n);
  const d = new Date(t);
  if (days === 0) return `今天 ${clock(d)}`;
  if (days === 1) return `昨天 ${clock(d)}`;
  if (days === 2) return `前天 ${clock(d)}`;
  if (days != null && days >= 3 && days <= 6) return `${days} 天前`;
  const current = new Date(n);
  if (days >= 7 && days <= 13) {
    const daysSinceMonday = (current.getDay() + 6) % 7;
    return days <= daysSinceMonday + 7 ? '上' + WEEK[d.getDay()] : `${days} 天前`;
  }
  if (days != null && days >= 14 && days <= 29) return `${Math.round(days / 7)} 周前`;
  if (days != null && days >= 30 && days <= 364) {
    const months = (current.getFullYear() - d.getFullYear()) * 12 + current.getMonth() - d.getMonth();
    if (months === 0) return `${Math.round(days / 7)} 周前`;
    return months === 1 ? '上个月' : `${months} 个月前`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 「多久以前」的短说法：刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 4 天前 / 2 个月前 */
export function timeAgo(ts, { now = Date.now() } = {}) {
  const t = toMs(ts);
  const n = toMs(now) || Date.now();
  if (!t) return '';
  const diff = Math.max(0, n - t);
  const minutes = diff / 60000;
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${Math.floor(minutes)} 分钟前`;
  const hours = minutes / 60;
  if (hours < 24 && dayDiff(t, n) === 0) return `${Math.floor(hours)} 小时前`;
  const days = dayDiff(t, n);
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days != null && days < 30) return `${days} 天前`;
  if (days != null && days < 365) return `${Math.max(1, Math.round(days / 30))} 个月前`;
  return '很久以前';
}