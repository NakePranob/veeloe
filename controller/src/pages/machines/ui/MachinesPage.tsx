import { router } from "expo-router";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineStatuses } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { Empty, Row, Screen, Section } from "../../../shared/ui";

// controller-prototype's MachinesPage.
export function MachinesPage() {
  const t = useT("machines");
  const machines = useMachines();
  const agents = useAgents() ?? [];
  const statuses = useMachineStatuses();
  return (
    <Screen title="Machine" right={{ label: t("pair"), onPress: () => router.push("/add-machine") }}>
      {machines?.length === 0 ? (
        <Empty icon="machine" title={t("none.title")} detail={t("none.body")} />
      ) : (
        <Section footer={t("footer")}>
          {machines?.map((machine) => {
            const online = statuses[machine.id]?.online ?? null;
            return (
              <Row
                key={machine.id}
                icon="machine"
                iconColor={online ? "green" : "tertiaryLabel"}
                title={machine.name}
                detail={t("agents", { count: agents.filter((a) => a.machine_id === machine.id).length })}
                value={online === null ? undefined : t(online ? "online" : "offline")}
                href={`/machines/${machine.id}`}
              />
            );
          })}
        </Section>
      )}
    </Screen>
  );
}
