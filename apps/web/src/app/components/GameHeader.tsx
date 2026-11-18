import type { GameScreen } from '../useNavigation';

const sections: { screen: GameScreen; label: string }[] = [
  { screen: 'arena', label: 'Арена' },
  { screen: 'skills', label: 'Навыки' },
  { screen: 'attributes', label: 'Характеристики' },
  { screen: 'world', label: 'Мир' },
  { screen: 'gathering', label: 'Вылазки' },
  { screen: 'crafting', label: 'Крафт' },
  { screen: 'inventory', label: 'Инвентарь' },
];

interface Props {
  screen: GameScreen;
  accountName: string;
  characterName?: string;
  partySize?: number;
  busy: boolean;
  onNavigate: (screen: GameScreen) => void;
  onParty: () => void;
  onCharacters: () => void;
  onAccount: () => void;
}

export function GameHeader({ screen, accountName, characterName, partySize, busy, onNavigate, onParty, onCharacters, onAccount }: Props) {
  return <header className="topbar">
    <a className="brand" href="#" onClick={() => onNavigate('arena')}>
      <span className="brand-mark">✦</span>
      <span>СТИХИИ<span className="brand-sub">TACTICAL MATCH–3</span></span>
    </a>
    <nav aria-label="Основная навигация">
      {sections.map(section => <button key={section.screen}
        onClick={() => onNavigate(section.screen)}
        className={screen === section.screen ? 'nav-active' : ''}>
        {section.label}
      </button>)}
    </nav>
    <div className="account-controls">
      <span title={`Аккаунт: ${accountName}`}>{characterName ?? accountName}</span>
      <button className="ghost" onClick={onParty}>Группа{partySize !== undefined ? ` · ${partySize}` : ''}</button>
      <button className="ghost" disabled={busy} onClick={onCharacters}>Персонажи</button>
      <button className="ghost" disabled={busy} onClick={onAccount}>Сменить аккаунт</button>
    </div>
  </header>;
}
