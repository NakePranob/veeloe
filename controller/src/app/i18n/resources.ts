import { addMachineI18n } from "../../pages/add-machine";
import { agentCharacterI18n } from "../../pages/agent-character";
import { agentMemoryI18n } from "../../pages/agent-memory";
import { agentsI18n } from "../../pages/agents";
import { agentAllowlistI18n } from "../../pages/agent-allowlist";
import { agentEgressI18n } from "../../pages/agent-egress";
import { agentGitI18n } from "../../pages/agent-git";
import { agentIdleWorkI18n } from "../../pages/agent-idle-work";
import { agentScheduleI18n } from "../../pages/agent-schedule";
import { agentI18n } from "../../pages/agent";
import { agentModelI18n } from "../../pages/agent-model";
import { newAgentI18n } from "../../pages/new-agent";
import { createKeyI18n } from "../../pages/create-key";
import { devicesI18n } from "../../pages/devices";
import { linkDeviceI18n } from "../../pages/link-device";
import { linkThisDeviceI18n } from "../../pages/link-this-device";
import { homeI18n } from "../../pages/home";
import { lockI18n } from "../../pages/lock";
import { machinesI18n } from "../../pages/machines";
import { storageUnavailableI18n } from "../../pages/storage-unavailable";
import { taskI18n } from "../../pages/task";
import { triggerThreadI18n } from "../../pages/trigger-thread";
import { usageI18n } from "../../pages/usage";
import { workspaceI18n } from "../../pages/workspace";
import { taskStatusI18n } from "../../entities/task";
import { agentInboxI18n } from "../../widgets/agent-inbox";
import { providerModelsI18n } from "../../widgets/provider-models";
import { errorsI18n, type Language } from "../../shared/i18n";

// One namespace per slice. Only this layer may see them all, since shared cannot import up.
const slices = {
  errors: errorsI18n,
  "task-status": taskStatusI18n,
  "agent-inbox": agentInboxI18n,
  "provider-models": providerModelsI18n,
  "add-machine": addMachineI18n,
  "agent-character": agentCharacterI18n,
  "agent-memory": agentMemoryI18n,
  agent: agentI18n,
  "agent-allowlist": agentAllowlistI18n,
  "agent-egress": agentEgressI18n,
  "agent-git": agentGitI18n,
  "agent-idle-work": agentIdleWorkI18n,
  "agent-schedule": agentScheduleI18n,
  "trigger-thread": triggerThreadI18n,
  "agent-model": agentModelI18n,
  agents: agentsI18n,
  "new-agent": newAgentI18n,
  "create-key": createKeyI18n,
  devices: devicesI18n,
  "link-device": linkDeviceI18n,
  "link-this-device": linkThisDeviceI18n,
  home: homeI18n,
  lock: lockI18n,
  machines: machinesI18n,
  "storage-unavailable": storageUnavailableI18n,
  task: taskI18n,
  usage: usageI18n,
  workspace: workspaceI18n,
};

const inLanguage = <L extends Language>(language: L) => Object.fromEntries(Object.entries(slices).map(([namespace, words]) => [namespace, words[language]]));

export const resources = { th: inLanguage("th"), en: inLanguage("en") };

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: false;
    resources: { [Namespace in keyof typeof slices]: (typeof slices)[Namespace]["en"] };
  }
}
