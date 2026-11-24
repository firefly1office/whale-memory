export declare const SOURCES: readonly ['asked', 'self', 'unknown']
export declare const TRIGGER_KINDS: readonly string[]

export type ActionSource = 'asked' | 'self' | 'unknown'

export interface TriggerDescriptor {
  /** 触发种类：user-request / user-mention / system / none */
  kind: 'user-request' | 'user-mention' | 'system' | 'none'
  /** kind=user-request 时可指定：用户要求的动作名 */
  action?: string
  /** kind=user-request 时可指定：用户要用的工具名 */
  tool?: string
}

export interface ClassifySourceInput {
  /** 这一条动作的名字，例如 draft_save / project_done */
  action?: string
  /** 这一轮调用的工具名，例如 self_project_draft */
  tool?: string
  /**
   * 这一轮的外部触发，必须是结构化描述：
   * - null：这一轮没有外部输入（唯一能得到 self 的入口）
   * - {kind:'user-request', action?, tool?}：用户要求
   * - {kind:'user-mention'}：提到但不是要求
   * - {kind:'system'}：定时器 / 空闲窗口 / 提醒（不是 self）
   * - 其它（含字符串）：unknown——自由文本不作为证据
   */
  trigger?: TriggerDescriptor | null
}

export declare function classifySource(input?: ClassifySourceInput | null): ActionSource
export declare function noExternalInput(): null
export declare function describeSource(source: string, opts?: { system?: boolean }): string