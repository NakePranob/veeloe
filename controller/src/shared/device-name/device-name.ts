import * as Device from "expo-device";

/**
 * A name to start this device's entry with, such as "Nake's iPhone".
 * It is a name, not a sentence, so it has no words to translate; the Owner can change it.
 */
export function deviceName(): string {
  return (Device.deviceName ?? Device.modelName ?? Device.osName ?? "").slice(0, 80);
}
