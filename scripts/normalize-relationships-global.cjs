const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

function parseEnvFile(filePath) {
  const out = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const m = content.match(/GOOGLE_SERVICE_ACCOUNT_JSON=(?:GOOGLE_SERVICE_ACCOUNT_JSON=)?([\s\S]*?)\nSHEET_ID=/);
  if (m) out.GOOGLE_SERVICE_ACCOUNT_JSON = m[1].trim();
  return out;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase();
}

function slugifyId(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildRelId(fromPersonId, toPersonId, relType) {
  return slugifyId(`${fromPersonId}-${toPersonId}-${relType}`);
}

function getIdxMap(headers) {
  const map = new Map();
  headers.forEach((h, i) => map.set(normalizeHeader(h), i));
  return map;
}

function getCell(row, map, key) {
  const idx = map.get(normalizeHeader(key));
  if (idx === undefined) return "";
  return String(row[idx] || "").trim();
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const service = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.JWT({
    email: service.client_email,
    key: String(service.private_key || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = env.SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Relationships!A1:ZZ",
  });
  const values = res.data.values || [];
  if (values.length === 0) {
    console.log(
      JSON.stringify(
        { ok: true, mode: apply ? "apply" : "dry-run", message: "Relationships tab is empty; no changes." },
        null,
        2,
      ),
    );
    return;
  }

  const headers = values[0].map((v) => String(v || ""));
  const rows = values.slice(1).map((r) => Array.from({ length: headers.length }, (_, i) => String(r[i] || "")));
  const idx = getIdxMap(headers);

  const fromKey = idx.has("from_person_id") ? "from_person_id" : "";
  const toKey = idx.has("to_person_id") ? "to_person_id" : "";
  const typeKey = idx.has("rel_type") ? "rel_type" : "";
  const idKey = idx.has("rel_id") ? "rel_id" : idx.has("relationship_id") ? "relationship_id" : "";

  if (!fromKey || !toKey || !typeKey || !idKey) {
    throw new Error("Relationships tab missing required columns (rel_id, from_person_id, to_person_id, rel_type).");
  }

  const seen = new Map();
  const duplicates = [];
  const invalid = [];
  let idUpdates = 0;
  const keptRows = [];

  rows.forEach((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const from = getCell(row, idx, fromKey);
    const to = getCell(row, idx, toKey);
    const relType = getCell(row, idx, typeKey).toLowerCase();
    const currentId = getCell(row, idx, idKey);

    if (!from || !to || !relType) {
      invalid.push({ rowNumber, relId: currentId, from, to, relType });
      keptRows.push(row);
      return;
    }

    const canonicalId = buildRelId(from, to, relType);
    const existing = seen.get(canonicalId);
    if (existing) {
      duplicates.push({
        canonicalId,
        dropRowNumber: rowNumber,
        keepRowNumber: existing.rowNumber,
        dropRelId: currentId,
        keepRelId: existing.relId,
      });
      return;
    }

    if (currentId !== canonicalId) {
      row[idx.get(normalizeHeader(idKey))] = canonicalId;
      idUpdates += 1;
    }

    seen.set(canonicalId, { rowNumber, relId: canonicalId });
    keptRows.push(row);
  });

  const report = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    spreadsheetId,
    tab: "Relationships",
    totalRowsBefore: rows.length,
    totalRowsAfter: keptRows.length,
    duplicateRowsToDelete: duplicates.length,
    relIdsToNormalize: idUpdates,
    invalidRowsUnchanged: invalid.length,
    sampleDuplicates: duplicates.slice(0, 10),
    sampleInvalidRows: invalid.slice(0, 10),
  };

  if (apply && (duplicates.length > 0 || idUpdates > 0)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Relationships!A1:ZZ",
      valueInputOption: "RAW",
      requestBody: {
        values: [headers, ...keptRows],
      },
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

