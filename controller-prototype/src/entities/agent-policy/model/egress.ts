// What may be written in an Egress list (ADR 0029). The proxy checks the address a name
// resolves to as well; this keeps the obvious internal names out of the list in the first place.

export type EntryCheck = { ok: true; entry: string } | { ok: false; reason: string };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function ipv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  return numbers.every((n) => n <= 255) ? numbers : null;
}

function internalV4([a, b]: number[]) {
  if (a === 0 || a === 127 || a === 10) return "loopback หรือเครือข่ายส่วนตัว";
  if (a === 172 && b >= 16 && b <= 31) return "เครือข่ายส่วนตัว 172.16.0.0/12";
  if (a === 192 && b === 168) return "เครือข่ายส่วนตัว 192.168.0.0/16";
  if (a === 169 && b === 254) return "link-local ซึ่งรวม 169.254.169.254 ที่ cloud ใช้แจก credential";
  if (a === 100 && b >= 64 && b <= 127) return "เครือข่ายส่วนตัวของผู้ให้บริการ 100.64.0.0/10";
  return null;
}

export function checkEntry(input: string): EntryCheck {
  // Paste a URL and keep only the host.
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host) return { ok: false, reason: "ใส่ชื่อโดเมน เช่น github.com" };
  if (host.includes(":") || host.startsWith("[")) return { ok: false, reason: "ที่อยู่ IPv6 ใช้ใน Egress ไม่ได้ ใส่เป็นชื่อโดเมน" };
  const bare = host.replace(/^\*\./, "");
  if (bare === "localhost" || bare.endsWith(".localhost")) return { ok: false, reason: "localhost คือเครื่องของ Machine เอง Egress ไม่เปิดให้" };
  if (/^[\d.]+$/.test(bare)) {
    const octets = ipv4(bare);
    if (!octets) return { ok: false, reason: "ใส่ IP แบบ a.b.c.d หรือใช้ชื่อโดเมน" };
    const why = internalV4(octets);
    if (why) return { ok: false, reason: `ที่อยู่ภายใน (${why}) ใส่ใน Egress ไม่ได้` };
    return { ok: true, entry: host };
  }
  if (!bare.includes(".") || !bare.split(".").every((label) => LABEL.test(label))) return { ok: false, reason: "ชื่อโดเมนไม่ถูกต้อง เช่น api.github.com หรือ *.example.com" };
  return { ok: true, entry: host };
}
