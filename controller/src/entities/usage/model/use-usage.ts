import { useLiveQuery } from "../../../shared/db";
import { LIST_USAGE_DAYS, USAGE_TOPIC, type UsageDayRow } from "./usage";

const TOPICS = [USAGE_TOPIC];

/** Every kept day of every Agent. Null until the first read lands. */
export function useUsageDays() {
  return useLiveQuery<UsageDayRow>(LIST_USAGE_DAYS, [], TOPICS);
}
