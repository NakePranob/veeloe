// A QR read by the phone's own camera opens veeloe://pair?..., which is the link itself rather than a screen.
export function redirectSystemPath({ path }: { path: string }) {
  const at = path.indexOf("pair?");
  return at === -1 ? path : `/add-machine?link=${encodeURIComponent(`veeloe://${path.slice(at)}`)}`;
}
