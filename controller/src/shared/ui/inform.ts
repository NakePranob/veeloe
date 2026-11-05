import { Alert } from "react-native";

// The platform's alert with one button, for something the Member should read before going on.
// React Native Web has no Alert, so the browser's own stands in there.
export function inform(title: string, message?: string) {
  if (process.env.EXPO_OS === "web") window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

// The platform's two-button alert; true when the action was chosen.
export function confirm({ title, message, action, cancel, destructive }: { title: string; message?: string; action: string; cancel: string; destructive?: boolean }): Promise<boolean> {
  if (process.env.EXPO_OS === "web") return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancel, style: "cancel", onPress: () => resolve(false) },
        { text: action, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
