export type UnsaidKind = 'draft' | 'question' | 'held'
export type UnsaidStatus = 'open' | 'spoken' | 'discarded'

export const KINDS: Set<UnsaidKind>
export const LIMITS: { text: number; reason: number }

export interface UnsaidItem {
  id: string
  day: string
  kind: UnsaidKind
  text: string
  reason: string
  status: 'open' | 'spoken'
  spokenDay?: string
}

type Fail = { ok: false; error: string }

/** 只在认得出的一对一会话里可用；同 kind 同原文还开着时重复提交是 noop */
export function leaveUnsaid(dir: string, opts: { chatKey: string; kind?: UnsaidKind; text: string; reason?: string }): { ok: true; id: string; day?: string; noop: boolean } | Fail
/** 默认只给开着的；all=true 连说出口的也给。丢掉的从不给 */
export function listUnsaid(dir: string, opts: { chatKey: string; all?: boolean }): { ok: true; items: UnsaidItem[] } | Fail
export function markUnsaidSpoken(dir: string, opts: { chatKey: string; id: string }): { ok: true; id: string; status: 'spoken'; noop: boolean } | Fail
export function discardUnsaid(dir: string, opts: { chatKey: string; id: string }): { ok: true; id: string; status: 'discarded'; noop: boolean } | Fail
/** 坏行数，只给数字 */
export function badLines(dir: string): number
export function eventsFile(dir: string): string
export const internals: { FILE: string }
