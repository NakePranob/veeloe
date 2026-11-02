import { getAutomation, updateAutomation } from "../../../entities/automation";
import { getChannels, updateChannel } from "../../../entities/channel";
import { getConnectors, removeConnector, updateConnector } from "../../../entities/connector";
import { newSignature } from "../../../features/signing";

// What a Member set up that runs on their signature: it stops when their key is revoked, and
// the Owner may sign it again in their own name before removing them (ADR 0031).
export interface Owned {
  id: string;
  kind: "Schedule" | "Idle Work" | "Watch" | "Channel" | "Connector";
  title: string;
  detail?: string;
  // Sign it again in the Owner's name.
  resign: () => void;
  // Not signed again: it stays stopped, and a Connector's credential is deleted.
  drop: () => void;
}

const none = () => {};

export function ownedBy(memberId: string): Owned[] {
  const { schedules, lists, watches } = getAutomation();
  const sign = () => {
    const { signedBy, signedDevice, signedAt } = newSignature();
    return { signedBy, signedDevice, signedAt };
  };
  return [
    ...schedules.filter((item) => item.signedBy === memberId).map((item): Owned => ({ id: item.id, kind: "Schedule", title: item.message, detail: item.agent, resign: () => updateAutomation("schedules", item.id, sign()), drop: none })),
    ...lists.filter((item) => item.signedBy === memberId).map((item): Owned => ({ id: item.id, kind: "Idle Work", title: item.name, detail: item.agent, resign: () => updateAutomation("lists", item.id, sign()), drop: none })),
    ...watches.filter((item) => item.signedBy === memberId).map((item): Owned => ({ id: item.id, kind: "Watch", title: item.path, detail: item.agent, resign: () => updateAutomation("watches", item.id, sign()), drop: none })),
    ...getChannels()
      .filter((item) => item.signedBy === memberId)
      .map((item): Owned => ({ id: item.id, kind: "Channel", title: item.chatName, detail: `${item.agent} · ${item.platform}`, resign: () => { const { signedBy, signedDevice } = sign(); updateChannel(item.id, { signedBy, signedDevice, stopped: false }); }, drop: () => updateChannel(item.id, { stopped: true }) })),
    ...getConnectors()
      .filter((item) => item.signedBy === memberId)
      .map((item): Owned => ({ id: item.id, kind: "Connector", title: item.title, detail: `${item.agent} · บัญชี ${item.account}`, resign: () => updateConnector(item.id, sign()), drop: () => removeConnector(item.id) })),
  ];
}
