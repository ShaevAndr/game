interface Props {
  ready: boolean;
  locked: boolean;
  isLeader: boolean;
  leaderName?: string;
  onStart: () => void;
}

export function WorldLobby({ ready, locked, isLeader, leaderName, onStart }: Props) {
  return <article className="panel world-lobby"><div className="world-compass" aria-hidden="true">✧</div>
      <h3>Что скрывается за следующим холмом?</h3><p>Открой карту, выбери участок и спустись за ресурсами. Срубленные деревья и прорытые ходы останутся до конца экспедиции.</p>
      <div className="world-lobby-facts"><span><b>Один мир</b>для всей группы</span><span><b>Личный груз</b>для твоего героя</span><span><b>Без спешки</b>прогресс сохраняется</span></div>
      <button className="primary" disabled={locked || !isLeader} onClick={onStart}>{!ready ? 'Подключение к миру…' : isLeader ? 'Начать экспедицию →' : 'Ожидаем лидера'}</button>
      <small>{!isLeader ? `${leaderName ?? 'Лидер'} может начать экспедицию.` : 'Отправляйся один или пригласи друзей в группу.'}</small>
    </article>;
}
