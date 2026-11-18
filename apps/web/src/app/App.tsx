import { CharacterSelectionPage } from '../features/characters/CharacterSelectionPage';
import { AccountSelectionPage } from '../features/identity/AccountSelectionPage';
import { useAccountSession } from '../features/identity/model/useAccountSession';
import { useParty } from '../features/parties/model/useParty';
import { SessionNotifications } from './components/SessionNotifications';
import { GameApp } from './GameApp';

export function App() {
  const identity = useAccountSession();
  const party = useParty(identity.session);
  const { session } = identity;
  if (!session) return <AccountSelectionPage identity={identity}/>;

  const chooseCharacters = () => void identity.selectCharacter(null).then(ok => {
    if (ok) location.hash = '';
  });
  const chooseAccount = () => void identity.logout().then(ok => {
    if (ok) location.hash = '';
  });

  return <>
    {session.characterId ? <GameApp key={`${session.account.id}:${session.characterId}`}
      session={session} sessionBusy={identity.busy} sessionError={identity.error} party={party}
      onCharacters={chooseCharacters} onAccount={chooseAccount}/>
      : <CharacterSelectionPage key={`characters:${session.account.id}`} account={session.account}
        busy={identity.busy} error={identity.error} onChoose={id => void identity.selectCharacter(id)}
        onAccount={() => void identity.logout()}/>}
    <SessionNotifications session={session} party={party}/>
  </>;
}
