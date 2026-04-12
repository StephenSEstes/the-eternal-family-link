import { scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export function verifyPassword(password: string, storedHash: string) {
  try {
    const [algo, n, r, p, saltHex, keyHex] = storedHash.split("$");
    if (algo !== "scrypt" || !n || !r || !p || !saltHex || !keyHex) {
      return false;
    }
    const derived = scryptSync(password, Buffer.from(saltHex, "hex"), KEY_LEN, {
      N: Number.parseInt(n, 10),
      r: Number.parseInt(r, 10),
      p: Number.parseInt(p, 10),
    });
    const stored = Buffer.from(keyHex, "hex");
    return stored.length === derived.length && timingSafeEqual(stored, derived);
  } catch {
    return false;
  }
}
