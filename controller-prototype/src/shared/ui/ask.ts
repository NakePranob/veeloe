import { Alert } from "react-native";

interface Confirm {
  title: string;
  message?: string;
  action: string;
  destructive?: boolean;
}

// The platform's alert, as a promise; web has only window.confirm.
export function confirm({ title, message, action, destructive }: Confirm): Promise<boolean> {
  if (process.env.EXPO_OS === "web") return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "ยกเลิก", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]);
  });
}

export function inform(title: string, message?: string) {
  if (process.env.EXPO_OS === "web") window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

// ponytail: stands in for Face ID, a fingerprint or the device passcode (ADR 0012). Run it
// before every action that ADR lists: Approval, Linking, Grant, Owner, installs, Allowlist,
// Egress, Pairing, releasing a Machine and Revocation.
export function authenticate(reason: string) {
  return confirm({ title: "ยืนยันตัวตน (จำลอง Face ID)", message: reason, action: "ยืนยัน" });
}
