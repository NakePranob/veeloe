// A QR read by the phone's own camera opens veeloe://pair?... or veeloe://link?..., which is the link itself rather than a screen.
// Both are read by the device joining: Pairing's by the Controller, Linking's by the new device.
const SCREEN = { pair: "/add-machine", link: "/link" } as const;

export function redirectSystemPath({ path }: { path: string }) {
  const match = /^(?:veeloe:)?\/*(pair|link)\?(.*)$/s.exec(path);
  if (!match) return path;
  const kind = match[1] as keyof typeof SCREEN;
  return `${SCREEN[kind]}?link=${encodeURIComponent(`veeloe://${kind}?${match[2]}`)}`;
}
