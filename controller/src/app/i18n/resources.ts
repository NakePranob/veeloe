import { addMachineI18n } from "../../pages/add-machine";
import { agentsI18n } from "../../pages/agents";
import { createKeyI18n } from "../../pages/create-key";
import { homeI18n } from "../../pages/home";
import { lockI18n } from "../../pages/lock";
import { machinesI18n } from "../../pages/machines";
import { otherTabI18n } from "../../pages/other-tab";
import { storageUnavailableI18n } from "../../pages/storage-unavailable";
import { taskI18n } from "../../pages/task";
import { workspaceI18n } from "../../pages/workspace";
import { taskStatusI18n } from "../../entities/task";
import { errorsI18n, type Language } from "../../shared/i18n";

// One namespace per slice. Only this layer may see them all, since shared cannot import up.
const slices = {
  errors: errorsI18n,
  "task-status": taskStatusI18n,
  "add-machine": addMachineI18n,
  agents: agentsI18n,
  "create-key": createKeyI18n,
  home: homeI18n,
  lock: lockI18n,
  machines: machinesI18n,
  "other-tab": otherTabI18n,
  "storage-unavailable": storageUnavailableI18n,
  task: taskI18n,
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
