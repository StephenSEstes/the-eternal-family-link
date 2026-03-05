function formatTenDigitPhone(digits: string) {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatUsPhoneForEdit(value: string | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) {
    return formatTenDigitPhone(digits);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return formatTenDigitPhone(digits.slice(1));
  }
  return raw;
}
