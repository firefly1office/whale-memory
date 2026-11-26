// 四本账（承诺 / 边界 / 拒绝 / 和解）与事件形状。实现见 ledger.js。
// 这一层是纯数据层：不读盘、不写盘；落盘与加锁由事件层 / 宿主负责。

export type LedgerBook = 'promise' | 'boundary' | 'refusal' | 'repair';

export type PromiseAction = 'made' | 'kept' | 'overdue' | 'released';
export type BoundaryAction = 'set' | 'crossed' | 'lifted';
export type RefusalAction = 'declined' | 'repeated' | 'withdrew';
export type RepairAction = 'attempted';

export type LedgerAction = PromiseAction | BoundaryAction | RefusalAction | RepairAction;

export type PromiseStatus = 'open' | 'kept' | 'overdue' | 'released';
export type BoundaryStatus = 'active' | 'lifted';
export type RefusalStatus = 'held' | 'withdrew';

/** 和解三档：未和解 / 部分和解 / 已和解。 */
export type RepairLevel = 'open' | 'partial' | 'repaired';
/** 一次和解尝试能覆盖到哪：partial = 部分，full = 彻底。 */
export type RepairScope = 'partial' | 'full';

/** 欠账出处。和解账只能对着这三本账里的一条记，不能对另一条和解记。 */
export interface LedgerTarget {
  book: Exclude<LedgerBook, 'repair'>;
  id: string;
}

export interface LedgerEvent {
  book: LedgerBook;
  action: LedgerAction;
  id: string;
  /** ISO 8601。默认取构造那一刻。 */
  at: string;
  /** promise.made / boundary.set / refusal.declined 必填。 */
  text?: string;
  /** promise.made 可选：没定什么时候还就不要填，不算逾期。 */
  dueAt?: string | null;
  /** kept / overdue / crossed / repeated / attempted 的可选说明。 */
  note?: string;
  /** released / lifted / withdrew / declined 的可选理由。 */
  reason?: string;
  /** repair.attempted 必填。 */
  target?: LedgerTarget;
  /** repair.attempted 必填。 */
  scope?: RepairScope;
}

export interface LedgerEventFields {
  id: string;
  at?: string;
  text?: string;
  dueAt?: string | null;
  note?: string;
  reason?: string;
  target?: LedgerTarget;
  scope?: RepairScope;
}

export interface PromiseState {
  book: 'promise';
  id: string;
  text: string;
  dueAt: string | null;
  status: PromiseStatus;
  overdueCount: number;
  /** 最近一次逾期的权重（2^(n-1)，封顶 8）。 */
  weight: number;
  /** 历次逾期权重之和。 */
  totalWeight: number;
  lastAt: string;
}

export interface BoundaryState {
  book: 'boundary';
  id: string;
  text: string;
  status: BoundaryStatus;
  crossings: number;
  firstCrossedAt: string | null;
  lastCrossedAt: string | null;
  lastAt: string;
}

export interface RefusalState {
  book: 'refusal';
  id: string;
  text: string;
  reason: string;
  status: RefusalStatus;
  repeats: number;
  lastAt: string;
}

export interface RepairState {
  book: 'repair';
  id: string;
  target: LedgerTarget | null;
  level: RepairLevel;
  attempts: number;
  lastAt: string;
}

export interface LedgerSnapshot {
  promise: Map<string, PromiseState>;
  boundary: Map<string, BoundaryState>;
  refusal: Map<string, RefusalState>;
  repair: Map<string, RepairState>;
}

export interface OverduePromise {
  id: string;
  text: string;
  dueAt: string;
  daysLate: number;
  overdueCount: number;
  weight: number;
  totalWeight: number;
}

export interface LedgerSummary {
  promise: { total: number; open: number; due: number; kept: number; overdue: number; released: number; weight: number };
  boundary: { total: number; active: number; lifted: number; crossings: number };
  refusal: { total: number; held: number; withdrew: number; repeats: number };
  repair: { total: number; open: number; partial: number; repaired: number; attempts: number };
}

export const BOOKS: readonly LedgerBook[];
export const ACTIONS: Readonly<Record<LedgerBook, readonly string[]>>;
export const PROMISE_STATUSES: readonly PromiseStatus[];
export const BOUNDARY_STATUSES: readonly BoundaryStatus[];
export const REFUSAL_STATUSES: readonly RefusalStatus[];
export const REPAIR_LEVELS: readonly RepairLevel[];
export const REPAIR_LEVEL_ZH: Readonly<Record<RepairLevel, string>>;
export const REPAIR_SCOPES: readonly RepairScope[];
export const OVERDUE_WEIGHT_CAP: number;

/** 第 n 次逾期的权重：2^(n-1)，封顶 cap（默认 8）。n=0 记 0。 */
export function overdueWeight(times: number, opts?: { cap?: number }): number;
/** 这条事件哪里不合格；合格返回 null。 */
export function eventProblem(e: unknown): string | null;
export function assertEvent<T>(e: T): T;
export function isValidEvent(e: unknown): boolean;
export function ledgerEvent(book: LedgerBook, action: LedgerAction, fields: LedgerEventFields): LedgerEvent;
/** 记账：追加一条事件，返回新数组；旧数组与旧事件都不动。 */
export function record(events: LedgerEvent[], book: LedgerBook, action: LedgerAction, fields: LedgerEventFields): LedgerEvent[];
export function foldLedger(events: LedgerEvent[]): LedgerSnapshot;
export function repairLevelOf(scope: RepairScope): RepairLevel;
export function repairLevelForAttempts(scopes?: RepairScope[]): RepairLevel;
export function overduePromises(snapshot: LedgerSnapshot, opts?: { now?: number }): OverduePromise[];
export function summarize(snapshot: LedgerSnapshot, opts?: { now?: number }): LedgerSummary;