import type { Fact, Verdict } from './evidence-policy.js'
import type { Experience } from './self-experience.js'

export function moodFacts(experiences: Experience[], opts?: { subject?: string }): Fact[]
export function quoteFacts(experiences: Experience[], opts?: { subject?: string }): Fact[]
export function factsFromExperiences(experiences: Experience[], opts?: { subject?: string }): Fact[]
export function ask(experiences: Experience[], opts: { slot: string; at?: string; subject?: string }): Verdict