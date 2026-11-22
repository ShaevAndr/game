/** Invalidation topics only; canonical data and commands remain REST. */
export const stateTopics = ['arena', 'rooms', 'parties', 'social', 'characters', 'world'] as const;
export type StateTopic = typeof stateTopics[number];
export interface StateInvalidation { topics: StateTopic[] }
