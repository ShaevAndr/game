import { Battle } from '@game/core';
export function BattleRewards({ battle, characterId }: { battle: Battle; characterId: string }) {
  if (battle.status !== 'finished') return null;
  const reward = battle.rewards?.find(r => r.characterId === characterId);
  return <div className="reward-summary" role="status">
    {reward ? <><strong>Победа! +{reward.experience} опыта</strong>{reward.levelsGained > 0 && <p>Повышение уровня: +{reward.levelsGained}. Получены очки навыков и прирост характеристик.</p>}<p>Открой экран «Навыки», чтобы развить персонажа.</p></> : <><strong>Бой завершён</strong><p>{battle.rewards?.length ? battle.rewards.map(r => `${battle.fighters.find(f => f.characterId === r.characterId)?.name ?? 'Герой'}: +${r.experience} опыта`).join(' · ') : 'Опыт начисляется только победившей команде.'}</p></>}
  </div>;
}
