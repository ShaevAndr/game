export abstract class SessionPresence {
  abstract refresh(sessionHash: string, characterId: string | null, expiresAt: number): Promise<void>;
  abstract onlineCharacterIds(now: number): Promise<string[]>;
}
