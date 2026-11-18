import type { useAccountSession } from './model/useAccountSession';
import { AccountSelectionScreen } from './components/AccountSelectionScreen';
import './identity.css';

export function AccountSelectionPage({ identity }: { identity: ReturnType<typeof useAccountSession> }) {
  return <AccountSelectionScreen
    accounts={identity.accounts}
    ready={identity.ready}
    busy={identity.busy}
    error={identity.error}
    onChoose={id => void identity.chooseAccount(id)}
    onCreate={identity.createAccount}
    onRefresh={() => void identity.refreshAccounts()}
  />;
}
