export type PersonDeathAttributeLike = {
  category?: string;
  attributeKind?: string;
  attributeType?: string;
  typeKey?: string;
  attributeTypeCategory?: string;
  attributeDate?: string;
  dateStart?: string;
  endDate?: string;
  dateEnd?: string;
  createdAt?: string;
  updatedAt?: string;
};

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function parseSortableDate(value?: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function resolveEventDate(attribute: PersonDeathAttributeLike) {
  return (
    String(attribute.attributeDate ?? "").trim() ||
    String(attribute.dateStart ?? "").trim() ||
    String(attribute.endDate ?? "").trim() ||
    String(attribute.dateEnd ?? "").trim()
  );
}

export function isDeathAttribute(attribute: PersonDeathAttributeLike) {
  const kind = normalize(attribute.category || attribute.attributeKind);
  const typeKey = normalize(attribute.attributeType || attribute.typeKey);
  const typeCategory = normalize(attribute.attributeTypeCategory);
  return (
    (kind === "" || kind === "event") &&
    (typeKey === "death" || typeCategory === "death")
  );
}

export function getDeathDateFromAttributes(attributes: PersonDeathAttributeLike[]) {
  const matches = attributes
    .filter(isDeathAttribute)
    .map((attribute) => ({
      value: resolveEventDate(attribute),
      sortDate:
        parseSortableDate(resolveEventDate(attribute)) ||
        parseSortableDate(attribute.updatedAt) ||
        parseSortableDate(attribute.createdAt),
    }))
    .filter((item) => item.value);
  if (matches.length === 0) {
    return "";
  }
  matches.sort((left, right) => {
    const leftHasDate = Number.isFinite(left.sortDate);
    const rightHasDate = Number.isFinite(right.sortDate);
    if (leftHasDate && rightHasDate && left.sortDate !== right.sortDate) {
      return right.sortDate - left.sortDate;
    }
    if (leftHasDate !== rightHasDate) {
      return leftHasDate ? -1 : 1;
    }
    return right.value.localeCompare(left.value);
  });
  return matches[0]?.value ?? "";
}

function parseIsoDate(value?: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return { year, month, day };
}

export function formatTreeVitalText(birthDate?: string, deathDate?: string) {
  const birth = parseIsoDate(birthDate);
  const death = parseIsoDate(deathDate);
  if (birth && death) {
    return `${birth.year} - ${death.year}`;
  }
  if (birth) {
    return `${String(birth.month).padStart(2, "0")}-${String(birth.day).padStart(2, "0")}`;
  }
  if (death) {
    return `- ${death.year}`;
  }
  return "";
}
