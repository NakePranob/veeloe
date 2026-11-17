import { Anuphan_400Regular } from "@expo-google-fonts/anuphan/400Regular";
import { Anuphan_500Medium } from "@expo-google-fonts/anuphan/500Medium";
import { Anuphan_600SemiBold } from "@expo-google-fonts/anuphan/600SemiBold";
import { Anuphan_700Bold } from "@expo-google-fonts/anuphan/700Bold";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk/700Bold";
import { useFonts } from "expo-font";
import { font } from "./theme";

// Each weight is imported on its own, so the weights the design does not use stay out of the bundle.
const files = {
  [font.regular]: Anuphan_400Regular,
  [font.medium]: Anuphan_500Medium,
  [font.semibold]: Anuphan_600SemiBold,
  [font.bold]: Anuphan_700Bold,
  [font.display]: SpaceGrotesk_700Bold,
  [font.mono]: JetBrainsMono_400Regular,
  [font.monoMedium]: JetBrainsMono_500Medium,
};

/** True once every font is ready, or once loading failed: then the system font stands in rather than a blank app. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(files);
  return loaded || error != null;
}
