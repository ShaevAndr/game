import { Modal } from '../../shared/ui/Modal';
import { PartyRoster } from './components/PartyRoster';
import type { useParty } from './model/useParty';
import './parties.css';

interface Props {
  party: ReturnType<typeof useParty>;
  playerId: string;
  characterId: string;
  onClose: () => void;
}

export function PartyPanel({ party, playerId, characterId, onClose }: Props) {
  return <Modal title="Группа" onClose={onClose}>
    <PartyRoster state={party.state} playerId={playerId} characterId={characterId}
      busy={party.busy} pending={party.pending} error={party.error} message={party.message}
      onAction={action => void party.act(action)} onRetry={party.retry} onRefresh={party.refresh}/>
  </Modal>;
}
