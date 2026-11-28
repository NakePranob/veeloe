import { parseInvitationLink } from "@veeloe/protocol-ts";
import { useEffect, useRef } from "react";
import { useMachineLink } from "../../../features/machine-link";
import { useDatabase, useLiveQuery } from "../../../shared/db";
import { INVITATION_TOPIC, joinedOf, LIST_INVITATIONS, saveAsk, takeRequest, type Invitation } from "../model/invite";

const TOPICS = [INVITATION_TOPIC];

/**
 * Listens for people asking in through this device's open Invitations whatever screen is open, and keeps each
 * request whose proof checks out, so it waits in the Inbox (ADR 0093). A request the Hub made up never checks out.
 */
export function InvitationRequests() {
  const link = useMachineLink();
  const database = useDatabase();
  const invitations = useLiveQuery<Invitation>(LIST_INVITATIONS, [], TOPICS);
  // Read fresh by the listener, so it is not torn down on every change of the list.
  const open = useRef<Invitation[]>([]);
  open.current = (invitations ?? []).filter((invitation) => invitation.closed_at === null && Date.now() < invitation.expires_at * 1000);
  useEffect(() => {
    if (!link) return;
    return link.onInvitationRequest((hub, request) => {
      for (const invitation of open.current) {
        if (invitation.hub_url !== hub) continue;
        const parsed = parseInvitationLink(invitation.link, 0);
        if (!parsed.ok) continue;
        const ask = takeRequest(parsed.link, request, joinedOf(invitation));
        if (ask) return void saveAsk(database, invitation.id, ask);
      }
    });
  }, [link, database]);
  return null;
}
