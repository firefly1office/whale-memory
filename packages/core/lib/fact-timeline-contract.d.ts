/**
 * 事实时间线契约：给「同槽位版本链」补三样东西。
 *
 * - 值轴 validFrom / validUntil：这件事在世界上什么时候为真（本模块不写）
 * - 知轴 factVersionAt / invalidatedAt：她什么时候知道、什么时候不再这么认为
 * - 序轴 version：同一槽位里谁在谁后面（追加顺序比时钟可信）
 */

export type SupersedeReason = 'update' | 'correction' | 'expiry' | 'retraction' | 'dedupe' | 'unknown';

export interface FactRecordLike {
  id?: string;
  version?: number | string;
  revisionOf?: string;
  supersededById?: string;
  factVersionAt?: number | string;
  invalidatedAt?: number | string | null;
  supersedeReason?: SupersedeReason | string;
  validFrom?: number | string | null;
  validUntil?: number | string | null;
  lineageId?: string;
  [key: string]: unknown;
}

export interface SuccessionPatch {
  before: {
    supersededById: string;
    declinedAt: null;
    invalidatedAt: number | null;
    supersedeReason: SupersedeReason;
  };
  after: {
    revisionOf: string;
    version: number;
  };
}

export interface LineageIssue {
  code: 'I0' | 'I1' | 'I2' | 'I3' | 'I4' | 'I5';
  id: string;
  message: string;
}

export interface ChainPatch {
  id: string;
  version: number;
  supersedeReason: SupersedeReason | null;
  invalidatedAt: number | null;
  supersededById: string;
  revisionOf?: string;
}

export interface ChainPlan {
  order: FactRecordLike[];
  patches: ChainPatch[];
  issues: LineageIssue[];
  orderBy: 'pointer' | 'time' | 'empty';
}

export function nextFactVersion(predecessor?: FactRecordLike | null): number;
export function stampSuccession(
  before: FactRecordLike,
  after: FactRecordLike,
  options?: { reason?: SupersedeReason | string; at?: number }
): SuccessionPatch;
export function applySuccession<T extends FactRecordLike, U extends FactRecordLike>(
  before: T,
  after: U,
  options?: { reason?: SupersedeReason | string; at?: number }
): { before: T; after: U; patch: SuccessionPatch };
export function validateLineage(records: FactRecordLike[] | null | undefined): LineageIssue[];
export function planChainVersions(records: FactRecordLike[] | null | undefined): ChainPlan;
export const SUPERSEDE_REASON_VALUES: SupersedeReason[];