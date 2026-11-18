import type { AccountSession } from '@game/core';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { PartyInvitationDialog } from '../../features/parties/components/PartyInvitationDialog';
import type { useParty } from '../../features/parties/model/useParty';
import '../../features/parties/parties.css';

export function SessionNotifications({ session, party }: { session: AccountSession; party: ReturnType<typeof useParty> }) {
  const currentParty = party.state?.party ?? null;
  const invitation = party.incoming[0];
  const inviteDisabled = !party.state || party.busy || party.pending || !!currentParty && (
    currentParty.leaderPlayerId !== session.account.id || currentParty.members.length >= party.state.capacity
  );
  return <>
    <ChatPanel key={`chat:${session.account.id}`} session={session} enabled={!!session.characterId}
      party={currentParty} onInvite={party.invite} inviteDisabled={inviteDisabled}/>
    {session.characterId && invitation && <PartyInvitationDialog
      key={invitation.id} invitation={invitation} serverNow={party.serverNow}
      busy={party.busy} pending={party.pending} error={party.error} onRetry={party.retry}
      onRespond={accept => void party.act({ type: accept ? 'accept' : 'decline', invitationId: invitation.id })}
    />}
  </>;
}
