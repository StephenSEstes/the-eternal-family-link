type PersonNameInput = {
  personId?: string;
  displayName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
};

function normalizePart(value: string | undefined) {
  return String(value ?? "").trim();
}

export function resolvePersonDisplayName(input: PersonNameInput) {
  const displayName = normalizePart(input.displayName);
  if (displayName) {
    return displayName;
  }
  const composed = [input.firstName, input.middleName, input.lastName]
    .map((value) => normalizePart(value))
    .filter(Boolean)
    .join(" ")
    .trim();
  if (composed) {
    return composed;
  }
  return normalizePart(input.personId);
}
