import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { encode } from "uqr";
import { Button } from "./button";
import { Text } from "./text";
import { qrInk, radius, space } from "./theme";

interface ScannerProps {
  onScan: (text: string) => void;
  // The words come from the page, since shared code has none of its own (ADR 0065).
  // hint: the line over the camera ("ส่อง QR ให้อยู่ในกรอบ").
  labels: { scan: string; stop: string; hint: string };
  // No camera here, or no permission: the page says to paste instead.
  onNoCamera: () => void;
}

// The corners of the frame the code goes in, drawn over the camera.
const FRAME = "M4 40V20A16 16 0 0 1 20 4h20M170 4h20a16 16 0 0 1 16 16v20M206 170v20a16 16 0 0 1-16 16h-20M40 206H20A16 16 0 0 1 4 190v-20";

// The camera reading one QR code, behind a button: Pairing's and Linking's scanner.
// The button starts it, since the camera permission is asked on that tap.
export function QrScanner({ onScan, labels, onNoCamera }: ScannerProps) {
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
        // Black whatever the theme, as a viewfinder is, with the frame and the hint over the picture.
        <View style={{ height: 250, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden", backgroundColor: qrInk.dark, alignItems: "center", justifyContent: "center" }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              setScanning(false);
              onScan(data);
            }}
          />
          <Svg width={210} height={210} viewBox="0 0 210 210" style={{ position: "absolute" }} aria-hidden>
            <Path d={FRAME} fill="none" stroke={qrInk.light} strokeWidth={4} strokeLinecap="round" />
          </Svg>
          <Text variant="footnote" style={{ color: qrInk.light, opacity: 0.7 }}>
            {labels.hint}
          </Text>
        </View>
      )}
      <Button size="large" leading={scanning ? undefined : "qr"} label={scanning ? labels.stop : labels.scan} onPress={() => (scanning ? setScanning(false) : void start())} />
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
