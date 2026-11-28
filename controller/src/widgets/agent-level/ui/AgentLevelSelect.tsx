import type { AgentRow } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { View } from "react-native";
import { Row, Select, space, Text, type SelectOption } from "../../../shared/ui";

interface Props<T extends string> {
  agent: Pick<AgentRow, "name" | "model" | "character">;
  /** The Machine it runs on, where the Agents page has its state: who is granted cares where, not what it is doing. */
  machine: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  cancel: string;
}

/**
 * An Agent and the level someone holds there, drawn as a row of the Agents page: its Character at 40pt, its name with
 * the model in mono, and its Machine below. Tapping opens the levels, as any Select does.
 */
export function AgentLevelSelect<T extends string>({ agent, machine, ...select }: Props<T>) {
  return <Select {...select} label={agent.name} tight leading={head(agent)} content={<Lines agent={agent} machine={machine} />} />;
}

/** The same row with a level that cannot change here, such as what an open Invitation gives. */
export function AgentLevelRow({ agent, machine, value }: { agent: Props<string>["agent"]; machine: string; value: string }) {
  return <Row title={agent.name} tight leading={head(agent)} content={<Lines agent={agent} machine={machine} />} value={value} />;
}

const head = (agent: Props<string>["agent"]) => <Character look={lookOfJson(agent.character)} mood={moodOf([], null)} size={40} still />;

function Lines({ agent, machine }: { agent: Props<string>["agent"]; machine: string }) {
  return (
    <View style={{ gap: space.xxs }}>
      <Text variant="subheadline" strong numberOfLines={1}>
        {`${agent.name} `}
        <Text variant="caption" tone="secondary" mono>
          {agent.model}
        </Text>
      </Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {machine}
      </Text>
    </View>
  );
}
