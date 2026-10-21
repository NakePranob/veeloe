import { router, useGlobalSearchParams } from "expo-router";
import { useWindowDimensions } from "react-native";

// At 1024 the app turns into three panes; below 1280 the Agent panel floats over the Task.
export function useWide() {
  return useWindowDimensions().width >= 1024;
}

export function useRoomy() {
  return useWindowDimensions().width >= 1280;
}

// Whether the Agent panel is open lives in the URL (?panel=1 or 0), so the layout and the
// Task header agree without shared state. With no param it opens when there is room.
export function usePanel() {
  const { panel } = useGlobalSearchParams<{ panel?: string }>();
  const roomy = useRoomy();
  const open = panel ? panel === "1" : roomy;
  return { open, floating: !roomy, toggle: () => router.setParams({ panel: open ? "0" : "1" }) };
}
