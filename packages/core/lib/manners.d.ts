export type MannerMode = 'say' | 'paraphrase' | 'withhold';

export interface MannerInput {
  /** 默认 false：不显式打开时恒为 say，与接入前一致。 */
  enabled?: boolean;
  place?: 'owner-private' | 'other-private' | 'group' | 'public';
  sensitivity?: 'normal' | 'private' | 'secret';
  source?: 'owner-said' | 'other-said' | 'herself' | 'unknown';
}

export interface MannerDecision {
  mode: MannerMode;
  reason: string;
  off?: boolean;
}

export const MODES: readonly MannerMode[];
export const PLACES: readonly string[];
export const SENSITIVITIES: readonly string[];
export const SOURCES: readonly string[];

export function decideManners(input?: MannerInput): MannerDecision;
export function renderMannersHint(decision?: MannerDecision, options?: { lang?: 'zh' | 'en' }): string;