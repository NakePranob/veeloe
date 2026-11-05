import { Alert } from "react-native";

// The platform's alert with one button, for something the Member should read before going on.
// React Native Web has no Alert, so the browser's own stands in there.
export function inform(title: string, message?: string) {
  if (process.env.EXPO_OS === "web") window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
