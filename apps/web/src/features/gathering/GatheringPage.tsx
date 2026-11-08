import { useGathering } from './model/useGathering';
import { GatheringScreen } from './components/GatheringScreen';
import './gathering.css';

interface Props {
  ownerId: string; busy: boolean; onError: (message: string) => void;
  run: (task: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
  onCrafting: () => void; onInventory: () => void;
}
export function GatheringPage({ ownerId, busy, onError, run, onChanged, onCrafting, onInventory }: Props) {
  const gathering = useGathering(ownerId, onError);
  return <GatheringScreen view={gathering.view} message={gathering.message} pending={gathering.pending} busy={busy}
    onAction={action => void run(async () => { await gathering.act(action); await onChanged(); })}
    onRetry={() => void run(async () => { await gathering.retry(); await onChanged(); })}
    onRefresh={() => void run(gathering.refresh)} onCrafting={onCrafting} onInventory={onInventory}/>;
}
