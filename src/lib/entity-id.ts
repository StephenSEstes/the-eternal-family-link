import { createHash, randomBytes } from "crypto";

export type EntityIdKind = "p" | "h" | "rel" | "attr" | "date";

const TOKEN_LENGTH = 8;

function normalizeSeed(seed: string) {
  return seed.trim().toLowerCase();
}

function tokenFromSeed(seed: string) {
  return createHash("sha1").update(seed).digest("hex").slice(0, TOKEN_LENGTH);
}

function randomToken() {
  return randomBytes(8).toString("hex").slice(0, TOKEN_LENGTH);
}

export function buildEntityId(kind: EntityIdKind, seed?: string) {
  const token = seed && normalizeSeed(seed) ? tokenFromSeed(normalizeSeed(seed)) : randomToken();
  return `${kind}-${token}`;
}

export function isTypedEntityId(value: string, kind: EntityIdKind) {
  const normalized = value.trim().toLowerCase();
  return new RegExp(`^${kind}-[a-z0-9]{${TOKEN_LENGTH}}$`).test(normalized);
}

export function buildUniqueEntityId(
  kind: EntityIdKind,
  seed: string,
  used: Set<string>,
) {
  let counter = 0;
  while (counter < 1000) {
    const suffix = counter === 0 ? "" : `#${counter}`;
    const candidate = buildEntityId(kind, `${seed}${suffix}`);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    counter += 1;
  }
  const fallback = buildEntityId(kind);
  used.add(fallback);
  return fallback;
}
