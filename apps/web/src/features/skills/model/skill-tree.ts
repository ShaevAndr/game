import type { Character, Content } from '@game/core';

export interface SkillTreeProps { character?: Character; content: Content | null; busy: boolean; onLearn: (id: string) => void; onUpgrade: (id: string, expectedLevel: number) => void }
