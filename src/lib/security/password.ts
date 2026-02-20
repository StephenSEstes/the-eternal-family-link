import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { TenantSecurityPolicy } from "@/lib/google/types";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

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

export function validatePasswordComplexity(password: string, policy: TenantSecurityPolicy) {
  if (password.length < policy.minLength) {
    return `Password must be at least ${policy.minLength} characters.`;
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    return "Password must include a number.";
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return "Password must include an uppercase letter.";
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    return "Password must include a lowercase letter.";
  }
  return "";
}
