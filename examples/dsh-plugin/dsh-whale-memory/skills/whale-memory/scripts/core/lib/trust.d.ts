// 信任六档与里程碑。实现见 trust.js。
// 纯函数：不读盘、不读时间、不保存全局状态；分数由调用方给。

export interface TrustBand {
  level: number;
  key: string;
  name: string;
  /** 进这一档的最低分；也是这一档的掉档线（跌破就掉）。 */
  enter: number;
}

export interface TrustMilestone {
  id: string;
  level: number;
  name: string;
}

export interface TrustState {
  level: number;
  /** 已连续几次观测停在下一档及以上（0..UP_CONFIRMATIONS-1）。 */
  upStreak: number;
  /** 到过的里程碑 id；掉档也不收回。 */
  milestones: readonly string[];
}

export interface TrustDecision {
  from: number;
  to: number;
  direction: 'up' | 'down' | 'hold';
  fromName: string;
  toName: string;
  score: number;
  /** 这次观测按纯阈值落在第几档（可能高于 to：升档要攒证据，不会一次到位）。 */
  target: number;
  upStreak: number;
  /** 还差几次达标观测才能升档；不在攒证据时为 0。 */
  missing: number;
  /** 这次新拿到的里程碑 id。 */
  newMilestones: readonly string[];
  reason: 'confirmed' | 'awaiting-evidence' | 'same-band' | 'below-level-floor';
}

export const TRUST_MAX: number;
export const TRUST_LEVELS: readonly TrustBand[];
export const UP_CONFIRMATIONS: number;
export const MILESTONES: readonly TrustMilestone[];

export function clampScore(score: number): number;
export function levelForScore(score: number): number;
export function bandFor(level: number): TrustBand;
export function milestonesForLevel(level: number): TrustMilestone[];
export function milestoneById(id: string): TrustMilestone | null;
export function createTrustState(init?: { level?: number; upStreak?: number; milestones?: readonly string[] }): TrustState;
/** 吃一次观测：返回新状态与判定，不修改传入的 state。 */
export function advanceTrust(state: TrustState, score: number): { state: TrustState; decision: TrustDecision };
export function foldTrust(scores?: number[], opts?: { initial?: TrustState }): { state: TrustState; decisions: TrustDecision[] };