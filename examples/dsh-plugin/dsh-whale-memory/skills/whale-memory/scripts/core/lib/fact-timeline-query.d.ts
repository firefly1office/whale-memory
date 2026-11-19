/** 时间线查询：知轴 / 值轴 / 变化对比。纯函数，不读写存储。 */

export interface FactRow {
  id?: string;
  version?: number | string;
  revisionOf?: string;
  supersededById?: string;
  factVersionAt?: number | string;
  invalidatedAt?: number | string | null;
  validFrom?: number | string | null;
  validUntil?: number | string | null;
  supersedeReason?: string;
  lineageId?: string;
  [key: string]: unknown;
}

export interface ChangeEntry {
  id: string;
  version: number | null;
  at: number;
  revisionOf: string;
  reason: string;
}

export function orderChain(records: FactRow[] | null | undefined): FactRow[];
export function currentVersion(records: FactRow[] | null | undefined): FactRow | null;
export function versionKnownAt(records: FactRow[] | null | undefined, asOf: number): FactRow | null;
export function valueValidAt(records: FactRow[] | null | undefined, asOf: number): FactRow | null;
export function changesBetween(records: FactRow[] | null | undefined, from: number, to: number): ChangeEntry[];
