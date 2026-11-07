export interface Account { id: string; name: string; createdAt: string }
export interface AccountSession { account: Account; characterId: string | null; expiresAt: number }
export interface AccountLogin extends AccountSession { token: string }

export const demoAccounts: Account[] = [
  { id: 'ac000000-0000-4000-8000-000000000001', name: 'Игрок 1', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'ac000000-0000-4000-8000-000000000002', name: 'Игрок 2', createdAt: '2026-01-01T00:00:00.000Z' },
];
