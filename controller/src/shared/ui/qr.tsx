import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { encode } from "uqr";
import { Button } from "./button";
import { qrInk, radius, space, useColors } from "./theme";

interface ScannerProps {
  onScan: (text: string) => void;
  // The words come from the page, since shared code has none of its own (ADR 0065).
  labels: { scan: string; stop: string };
  // No camera here, or no permission: the page says to paste instead.
  onNoCamera: () => void;
}

// The camera reading one QR code, behind a button: Pairing's and Linking's scanner.
export function QrScanner({ onScan, labels, onNoCamera }: ScannerProps) {
  const colors = useColors();
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function start() {
    const granted = permission?.granted || (await requestPermission()).granted;
    if (granted) setScanning(true);
    else onNoCamera();
  }

  return (
    <>
      {scanning && (
        <View style={{ aspectRatio: 1, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.chip }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              setScanning(false);
              onScan(data);
            }}
          />
        </View>
      )}
      <View style={{ flexDirection: "row" }}>
        <Button label={scanning ? labels.stop : labels.scan} onPress={() => (scanning ? setScanning(false) : void start())} />
      </View>
    </>
  );
}

// A QR code drawn as one path, dark on white whatever the theme, as cameras expect.
export function QrCode({ text, label, size = 240 }: { text: string; label: string; size?: number }) {
  const { data } = encode(text, { ecc: "L", border: 2 });
  const path = data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ""))).join("");
  return (
    <View role="img" aria-label={label} style={{ alignSelf: "center", padding: space.sm, borderRadius: radius.sm, backgroundColor: qrInk.light }}>
      <Svg width={size} height={size} viewBox={`0 0 ${data.length} ${data.length}`}>
        <Path d={path} fill={qrInk.dark} />
      </Svg>
    </View>
  );
}
