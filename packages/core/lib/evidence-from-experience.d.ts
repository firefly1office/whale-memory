import type { Fact, Verdict } from './evidence-policy.js'
import type { Experience } from './self-experience.js'

export function moodFacts(experiences: Experience[], opts?: { subject?: string }): Fact[]
export function quoteFacts(experiences: Experience[], opts?: { subject?: string }): Fact[]
/** 她对每件事的感觉：slot 为 feeling:<经历 id>；后来写了感觉的后记会取代前一条 */
export function feelingFacts(experiences: Experience[], opts?: { subject?: string }): Fact[]
export function factsFromExperiences(experiences: Experience[], opts?: { subject?: string }): Fact[]
export function ask(experiences: Experience[], opts: { slot: string; at?: string; subject?: string }): Verdict