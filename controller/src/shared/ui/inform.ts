import { Alert } from "react-native";

// The platform's alert with one button, for something the Member should read before going on.
export function inform(title: string, message?: string) {
  Alert.alert(title, message);
}

// The platform's two-button alert; true when the action was chosen.
export function confirm({ title, message, action, cancel, destructive }: { title: string; message?: string; action: string; cancel: string; destructive?: boolean }): Promise<boolean> {
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
