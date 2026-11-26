import { Stack, useNavigation } from "expo-router";
import { useEffect } from "react";
import { Button } from "./button";
import { iosSymbol, type IconName } from "./icon";

interface Props {
  label: string;
  onPress: () => void;
  // Without one the label is the button. With one, the label is what a screen reader says.
  icon?: IconName;
  disabled?: boolean;
  placement?: "left" | "right";
  // How our own header button looks; iOS draws the platform's toolbar item instead.
  variant?: "primary" | "chip" | "ghost";
}

// Android's header button is ours, since Stack.Toolbar is iOS's.
// Setting an option outlives the component, so leaving takes the button with it.
function OwnHeaderAction({ label, onPress, icon, disabled, placement = "right", variant }: Props) {
  const navigation = useNavigation();
  const option = placement === "left" ? "headerLeft" : "headerRight";
  useEffect(() => () => navigation.setOptions({ [option]: undefined }), [navigation, option]);
  return <Stack.Screen options={{ [option]: () => <Button label={label} icon={icon} disabled={disabled} variant={variant ?? (icon || placement === "left" ? "chip" : "primary")} onPress={onPress} /> }} />;
}

// A button in the header is the platform's own, the same as the back button beside it.
export function HeaderAction(props: Props) {
  // Stack.Toolbar is an iOS native toolbar; Android draws the header button
  // with our own Button (Android has no @expo/ui dependency).
  if (process.env.EXPO_OS !== "ios") return <OwnHeaderAction {...props} />;
  const { label, onPress, icon, disabled, placement = "right" } = props;
  return (
    <Stack.Toolbar placement={placement}>
      {/* ponytail: Android's toolbar takes only image icons, so it shows the label; add @expo/material-symbols when Android is checked. */}
      <Stack.Toolbar.Button icon={icon && process.env.EXPO_OS === "ios" ? iosSymbol(icon) : undefined} accessibilityLabel={label} disabled={disabled} onPress={onPress}>
        {label}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
