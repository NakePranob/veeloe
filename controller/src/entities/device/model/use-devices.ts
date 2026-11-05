import { useLiveQuery } from "../../../shared/db";
import { DEVICE_TOPIC, LIST_DEVICES, type Device } from "./devices";

const TOPICS = [DEVICE_TOPIC];

/** Null until the first read lands. */
export function useDevices() {
  return useLiveQuery<Device>(LIST_DEVICES, [], TOPICS);
}
