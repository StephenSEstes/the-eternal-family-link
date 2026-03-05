#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const oracledb = require("oracledb");

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;
  const text = fs.readFileSync(dotEnvPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}

function shortHash(seed) {
  return crypto.createHash("sha1").update(String(seed).trim().toLowerCase()).digest("hex").slice(0, 8);
}

function mediaId(fileId) {
  return `media-${shortHash(`file|${fileId}`)}`;
}

function linkId(familyGroupKey, entityType, entityId, fileId, usageType) {
  return `mlink-${shortHash(`${familyGroupKey}|${entityType}|${entityId}|${fileId}|${usageType}`)}`;
}

function norm(v) {
  return String(v ?? "").trim();
}

async function upsertMediaAsset(conn, row) {
  await conn.execute(
    `MERGE INTO media_assets t
     USING (SELECT :mediaId media_id, :fileId file_id, :storageProvider storage_provider, :mimeType mime_type,
                   :fileName file_name, :fileSizeBytes file_size_bytes, :mediaMetadata media_metadata, :createdAt created_at
            FROM dual) s
     ON (TRIM(t.media_id)=TRIM(s.media_id))
     WHEN MATCHED THEN UPDATE SET
       t.file_id=s.file_id,
       t.storage_provider=s.storage_provider,
       t.mime_type=s.mime_type,
       t.file_name=s.file_name,
       t.file_size_bytes=s.file_size_bytes,
       t.media_metadata=s.media_metadata,
       t.created_at=s.created_at
     WHEN NOT MATCHED THEN INSERT
       (media_id,file_id,storage_provider,mime_type,file_name,file_size_bytes,media_metadata,created_at)
       VALUES
       (s.media_id,s.file_id,s.storage_provider,s.mime_type,s.file_name,s.file_size_bytes,s.media_metadata,s.created_at)`,
    row,
    { autoCommit: false },
  );
}

async function upsertMediaLink(conn, row) {
  await conn.execute(
    `MERGE INTO media_links t
     USING (SELECT
       :familyGroupKey family_group_key,
       :linkId link_id,
       :mediaId media_id,
       :entityType entity_type,
       :entityId entity_id,
       :usageType usage_type,
       :label label,
       :description description,
       :photoDate photo_date,
       :isPrimary is_primary,
       :sortOrder sort_order,
       :mediaMetadata media_metadata,
       :createdAt created_at
     FROM dual) s
     ON (TRIM(t.link_id)=TRIM(s.link_id))
     WHEN MATCHED THEN UPDATE SET
       t.family_group_key=s.family_group_key,
       t.media_id=s.media_id,
       t.entity_type=s.entity_type,
       t.entity_id=s.entity_id,
       t.usage_type=s.usage_type,
       t.label=s.label,
       t.description=s.description,
       t.photo_date=s.photo_date,
       t.is_primary=s.is_primary,
       t.sort_order=s.sort_order,
       t.media_metadata=s.media_metadata,
       t.created_at=s.created_at
     WHEN NOT MATCHED THEN INSERT
       (family_group_key,link_id,media_id,entity_type,entity_id,usage_type,label,description,photo_date,is_primary,sort_order,media_metadata,created_at)
       VALUES
       (s.family_group_key,s.link_id,s.media_id,s.entity_type,s.entity_id,s.usage_type,s.label,s.description,s.photo_date,s.is_primary,s.sort_order,s.media_metadata,s.created_at)`,
    row,
    { autoCommit: false },
  );
}

async function queryRows(conn, sql, binds = {}) {
  const res = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return res.rows || [];
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env.local"));
  requireEnv("OCI_DB_CONNECT_STRING", "OCI_DB_USER", "OCI_DB_PASSWORD", "TNS_ADMIN", "OCI_WALLET_PASSWORD");

  const conn = await oracledb.getConnection({
    user: process.env.OCI_DB_USER,
    password: process.env.OCI_DB_PASSWORD,
    connectString: process.env.OCI_DB_CONNECT_STRING,
    configDir: process.env.TNS_ADMIN,
    walletLocation: process.env.TNS_ADMIN,
    walletPassword: process.env.OCI_WALLET_PASSWORD,
  });

  const stats = {
    assetsProcessed: 0,
    linksProcessed: 0,
    personProfileLinks: 0,
    householdGalleryLinks: 0,
    householdWeddingLinks: 0,
    attributePhotoLinks: 0,
  };

  try {
    const memberships = await queryRows(
      conn,
      `SELECT TRIM(person_id) AS person_id, LOWER(TRIM(family_group_key)) AS family_group_key
       FROM person_family_groups
       WHERE TRIM(NVL(person_id, '')) <> ''
         AND TRIM(NVL(family_group_key, '')) <> ''
         AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('true','yes','1') OR TRIM(NVL(is_enabled, '')) = '')`,
    );
    const familyKeysByPerson = new Map();
    for (const row of memberships) {
      const personId = norm(row.PERSON_ID);
      const familyGroupKey = norm(row.FAMILY_GROUP_KEY).toLowerCase();
      if (!personId || !familyGroupKey) continue;
      const set = familyKeysByPerson.get(personId) || new Set();
      set.add(familyGroupKey);
      familyKeysByPerson.set(personId, set);
    }

    const peopleRows = await queryRows(
      conn,
      `SELECT TRIM(person_id) AS person_id, TRIM(photo_file_id) AS file_id
       FROM people
       WHERE TRIM(NVL(photo_file_id, '')) <> ''`,
    );
    for (const row of peopleRows) {
      const personId = norm(row.PERSON_ID);
      const fileId = norm(row.FILE_ID);
      if (!personId || !fileId) continue;
      const media = mediaId(fileId);
      await upsertMediaAsset(conn, {
        mediaId: media,
        fileId,
        storageProvider: "legacy",
        mimeType: "",
        fileName: "",
        fileSizeBytes: "",
        mediaMetadata: "",
        createdAt: "",
      });
      stats.assetsProcessed += 1;
      const familyKeys = familyKeysByPerson.get(personId) || new Set();
      for (const familyGroupKey of familyKeys) {
        await upsertMediaLink(conn, {
          familyGroupKey,
          linkId: linkId(familyGroupKey, "person", personId, fileId, "profile"),
          mediaId: media,
          entityType: "person",
          entityId: personId,
          usageType: "profile",
          label: "headshot",
          description: "",
          photoDate: "",
          isPrimary: "TRUE",
          sortOrder: "0",
          mediaMetadata: "",
          createdAt: "",
        });
        stats.linksProcessed += 1;
        stats.personProfileLinks += 1;
      }
    }

    const householdPhotoRows = await queryRows(
      conn,
      `SELECT LOWER(TRIM(family_group_key)) AS family_group_key,
              TRIM(household_id) AS household_id,
              TRIM(file_id) AS file_id,
              NVL(TRIM(name), '') AS name,
              NVL(TRIM(description), '') AS description,
              NVL(TRIM(photo_date), '') AS photo_date,
              NVL(TRIM(is_primary), 'FALSE') AS is_primary,
              NVL(TRIM(media_metadata), '') AS media_metadata
       FROM household_photos
       WHERE TRIM(NVL(file_id, '')) <> ''`,
    );
    for (const row of householdPhotoRows) {
      const familyGroupKey = norm(row.FAMILY_GROUP_KEY).toLowerCase();
      const householdId = norm(row.HOUSEHOLD_ID);
      const fileId = norm(row.FILE_ID);
      if (!familyGroupKey || !householdId || !fileId) continue;
      const media = mediaId(fileId);
      const metadata = norm(row.MEDIA_METADATA);
      await upsertMediaAsset(conn, {
        mediaId: media,
        fileId,
        storageProvider: "legacy",
        mimeType: "",
        fileName: norm(row.NAME),
        fileSizeBytes: "",
        mediaMetadata: metadata,
        createdAt: "",
      });
      stats.assetsProcessed += 1;
      await upsertMediaLink(conn, {
        familyGroupKey,
        linkId: linkId(familyGroupKey, "household", householdId, fileId, "gallery"),
        mediaId: media,
        entityType: "household",
        entityId: householdId,
        usageType: "gallery",
        label: norm(row.NAME),
        description: norm(row.DESCRIPTION),
        photoDate: norm(row.PHOTO_DATE),
        isPrimary: norm(row.IS_PRIMARY).toLowerCase() === "true" ? "TRUE" : "FALSE",
        sortOrder: "0",
        mediaMetadata: metadata,
        createdAt: "",
      });
      stats.linksProcessed += 1;
      stats.householdGalleryLinks += 1;
    }

    const weddingRows = await queryRows(
      conn,
      `SELECT LOWER(TRIM(family_group_key)) AS family_group_key,
              TRIM(household_id) AS household_id,
              TRIM(wedding_photo_file_id) AS file_id
       FROM households
       WHERE TRIM(NVL(wedding_photo_file_id, '')) <> ''`,
    );
    for (const row of weddingRows) {
      const familyGroupKey = norm(row.FAMILY_GROUP_KEY).toLowerCase();
      const householdId = norm(row.HOUSEHOLD_ID);
      const fileId = norm(row.FILE_ID);
      if (!familyGroupKey || !householdId || !fileId) continue;
      const media = mediaId(fileId);
      await upsertMediaAsset(conn, {
        mediaId: media,
        fileId,
        storageProvider: "legacy",
        mimeType: "",
        fileName: "",
        fileSizeBytes: "",
        mediaMetadata: "",
        createdAt: "",
      });
      stats.assetsProcessed += 1;
      await upsertMediaLink(conn, {
        familyGroupKey,
        linkId: linkId(familyGroupKey, "household", householdId, fileId, "wedding"),
        mediaId: media,
        entityType: "household",
        entityId: householdId,
        usageType: "wedding",
        label: "wedding",
        description: "",
        photoDate: "",
        isPrimary: "TRUE",
        sortOrder: "0",
        mediaMetadata: "",
        createdAt: "",
      });
      stats.linksProcessed += 1;
      stats.householdWeddingLinks += 1;
    }

    const attributeRows = await queryRows(
      conn,
      `SELECT TRIM(attribute_id) AS attribute_id,
              TRIM(person_id) AS person_id,
              LOWER(TRIM(attribute_type)) AS attribute_type,
              TRIM(value_text) AS file_id,
              NVL(TRIM(label), '') AS label,
              NVL(TRIM(notes), '') AS notes,
              NVL(TRIM(start_date), '') AS start_date,
              NVL(TRIM(is_primary), 'FALSE') AS is_primary,
              NVL(TRIM(sort_order), '0') AS sort_order,
              NVL(TRIM(value_json), '') AS value_json,
              NVL(TRIM(media_metadata), '') AS media_metadata
       FROM person_attributes
       WHERE LOWER(TRIM(attribute_type)) = 'photo'
         AND TRIM(NVL(value_text, '')) <> ''`,
    );
    for (const row of attributeRows) {
      const attributeId = norm(row.ATTRIBUTE_ID);
      const personId = norm(row.PERSON_ID);
      const fileId = norm(row.FILE_ID);
      if (!attributeId || !personId || !fileId) continue;
      const metadata = norm(row.MEDIA_METADATA) || norm(row.VALUE_JSON);
      const media = mediaId(fileId);
      await upsertMediaAsset(conn, {
        mediaId: media,
        fileId,
        storageProvider: "legacy",
        mimeType: "",
        fileName: "",
        fileSizeBytes: "",
        mediaMetadata: metadata,
        createdAt: "",
      });
      stats.assetsProcessed += 1;
      const familyKeys = familyKeysByPerson.get(personId) || new Set();
      for (const familyGroupKey of familyKeys) {
        await upsertMediaLink(conn, {
          familyGroupKey,
          linkId: linkId(familyGroupKey, "attribute", attributeId, fileId, "photo"),
          mediaId: media,
          entityType: "attribute",
          entityId: attributeId,
          usageType: "photo",
          label: norm(row.LABEL),
          description: norm(row.NOTES),
          photoDate: norm(row.START_DATE),
          isPrimary: norm(row.IS_PRIMARY).toLowerCase() === "true" ? "TRUE" : "FALSE",
          sortOrder: norm(row.SORT_ORDER) || "0",
          mediaMetadata: metadata,
          createdAt: "",
        });
        stats.linksProcessed += 1;
        stats.attributePhotoLinks += 1;
      }
    }

    await conn.commit();
    console.log("Media backfill complete.");
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(`Media backfill failed: ${error.message}`);
  process.exit(1);
});
