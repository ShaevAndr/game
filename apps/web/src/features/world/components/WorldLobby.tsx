interface Props {
  ready: boolean;
  locked: boolean;
  isLeader: boolean;
  leaderName?: string;
  onStart: () => void;
}

export function WorldLobby({ ready, locked, isLeader, leaderName, onStart }: Props) {
  return <article className="panel world-lobby">
      <h3>Новая экспедиция</h3>
      <button className="primary" disabled={locked || !isLeader} onClick={onStart}>{!ready ? 'Подключение к миру…' : isLeader ? 'Начать экспедицию →' : 'Ожидаем лидера'}</button>
      {!isLeader && <small>{leaderName ?? 'Лидер'} может начать экспедицию.</small>}
    </article>;
}
