function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeDate(input: string) {
  const raw = input.trim();
  if (!raw) {
    return "";
  }

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

export function buildPersonId(fullName: string, birthDate: string) {
  const nameSlug = slugify(fullName);
  const normalizedBirthDate = normalizeDate(birthDate).replace(/-/g, "");
  if (!nameSlug || !normalizedBirthDate) {
    return "";
  }
  return `${normalizedBirthDate}-${nameSlug}`;
}
