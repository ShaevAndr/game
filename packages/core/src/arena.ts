/** Persistent duel offers; a pending offer does not reserve either character. */
export interface ArenaChallenge {
  id: string;
  battleId: string;
  roomName: string;
  challengerId: string;
  challengerName: string;
  recipientId: string;
  recipientName: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: string;
}

export interface ArenaState {
  incoming: ArenaChallenge[];
  outgoing: ArenaChallenge[];
  activeBattleId: string | null;
}
