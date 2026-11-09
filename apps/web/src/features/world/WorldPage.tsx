import type { Party, Content } from '@game/core';
import { useWorld } from './model/useWorld';
import { WorldScreen } from './components/WorldScreen';
import './world.css';
interface Props {
  playerId: string; characterId: string; party: Party | null; partyReady: boolean; partyBusy: boolean; content: Content | null;
  onChanged: () => Promise<void>; onInventory: () => void; onCrafting: () => void; onGathering: () => void;
}
export function WorldPage(props: Props) {
  const world = useWorld(props.playerId, props.characterId, props.party, props.onChanged);
  return <WorldScreen {...props} world={world}/>;
}
