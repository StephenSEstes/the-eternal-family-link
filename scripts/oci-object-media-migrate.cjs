#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const oracledb = require("oracledb");
const sharp = require("sharp");
const { google } = require("googleapis");
const { ObjectStorageClient } = require("oci-objectstorage");
const { ConfigFileAuthenticationDetailsProvider } = require("oci-common");

oracledb.fetchAsString = [oracledb.CLOB];

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

function readRequiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag) => args.includes(flag);
  const readValue = (flag, fallback = "") => {
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    return String(args[index + 1] ?? "").trim();
  };
  const limitRaw = readValue("--limit");
  const limit = Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0 ? Math.trunc(Number(limitRaw)) : 0;
  return {
    apply: has("--apply"),
    tenantKey: readValue("--tenant"),
    limit,
  };
}

function normalizeTenantKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function safeParseJson(value) {
  const raw = normalizeText(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeObjectNameSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

function getExtensionFromMimeType(mimeType) {
  const normalized = normalizeText(mimeType).toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "audio/mpeg") return "mp3";
  return "bin";
}

function getExtensionFromFileName(fileName) {
  const base = path.basename(normalizeText(fileName));
  const ext = path.extname(base).replace(/^\./, "").toLowerCase();
  return ext || "";
}

function readThumbMaxEdge() {
  const raw = Number.parseInt(String(process.env.EFL_IMAGE_THUMB_MAX_EDGE ?? "").trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) return 480;
  return Math.max(120, Math.min(1600, raw));
}

function readThumbQuality() {
  const raw = Number.parseInt(String(process.env.EFL_IMAGE_THUMB_QUALITY ?? "").trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) return 78;
  return Math.max(40, Math.min(95, raw));
}

async function createThumbnailIfImage(buffer, mimeType) {
  const normalized = normalizeText(mimeType).toLowerCase();
  if (!normalized.startsWith("image/")) return null;
  const rendered = await sharp(buffer, { failOn: "none", animated: false })
    .rotate()
    .resize({
      width: readThumbMaxEdge(),
      height: readThumbMaxEdge(),
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: readThumbQuality(), mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const width = Number(rendered.info.width ?? 0);
  const height = Number(rendered.info.height ?? 0);
  if (!width || !height) return null;

  return {
    buffer: rendered.data,
    mimeType: "image/jpeg",
    extension: "jpg",
    width,
    height,
    sizeBytes: rendered.data.length,
  };
}

function createDriveClient() {
  const serviceAccountJson = readRequiredEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  let parsed;
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${error.message}`);
  }
  const auth = new google.auth.GoogleAuth({
    credentials: parsed,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

function createObjectStorageClient(config) {
  const configFilePath = normalizeText(process.env.OCI_CONFIG_FILE) || undefined;
  const profile = normalizeText(process.env.OCI_CONFIG_PROFILE) || undefined;
  const provider = new ConfigFileAuthenticationDetailsProvider(configFilePath, profile);
  const client = new ObjectStorageClient({ authenticationDetailsProvider: provider });
  client.endpoint = `https://objectstorage.${config.region}.oraclecloud.com`;
  return client;
}

function buildMigrationMetadata(input) {
  const next = {
    ...input.baseMetadata,
    mediaKind: normalizeText(input.baseMetadata.mediaKind) || "",
    sourceProvider: "google_drive",
    sourceFileId: input.fileId,
    objectStorage: {
      provider: "oci_object",
      namespace: input.namespace,
      bucketName: input.bucketName,
      originalObjectKey: input.originalObjectKey,
      thumbnailObjectKey: input.thumbnailObjectKey || "",
      migratedAt: new Date().toISOString(),
      sourceFileId: input.fileId,
    },
  };
  if (input.thumbnailObjectKey) {
    next.thumbnailObjectKey = input.thumbnailObjectKey;
    next.thumbnailMimeType = input.thumbnailMimeType;
    next.thumbnailWidth = input.thumbnailWidth;
    next.thumbnailHeight = input.thumbnailHeight;
    next.thumbnailSizeBytes = input.thumbnailSizeBytes;
  }
  return next;
}

async function queryRows(conn, sql, binds = {}) {
  const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return result.rows || [];
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env.local"));
  const options = parseArgs();
  const tenantKey = normalizeTenantKey(options.tenantKey);

  const dbConfig = {
    connectString: readRequiredEnv("OCI_DB_CONNECT_STRING"),
    user: readRequiredEnv("OCI_DB_USER"),
    password: readRequiredEnv("OCI_DB_PASSWORD"),
    tnsAdmin: readRequiredEnv("TNS_ADMIN"),
    walletPassword: readRequiredEnv("OCI_WALLET_PASSWORD"),
  };
  const objectConfig = {
    region: readRequiredEnv("OCI_REGION"),
    namespace: readRequiredEnv("OCI_OBJECT_NAMESPACE"),
    bucketName: readRequiredEnv("OCI_OBJECT_BUCKET"),
    objectPrefix: normalizeText(process.env.OCI_OBJECT_MEDIA_PREFIX) || "efl-media",
  };

  const drive = createDriveClient();
  const objectStorage = createObjectStorageClient(objectConfig);
  const connection = await oracledb.getConnection({
    user: dbConfig.user,
    password: dbConfig.password,
    connectString: dbConfig.connectString,
    configDir: dbConfig.tnsAdmin,
    walletLocation: dbConfig.tnsAdmin,
    walletPassword: dbConfig.walletPassword,
  });

  const stats = {
    scanned: 0,
    migrated: 0,
    skippedAlreadyMigrated: 0,
    skippedNoFileId: 0,
    thumbnailsCreated: 0,
    failed: 0,
  };
  const failures = [];

  try {
    const binds = {};
    let whereTenant = "";
    if (tenantKey) {
      binds.tenantKey = tenantKey;
      whereTenant = `
        AND EXISTS (
          SELECT 1
          FROM media_links ml
          WHERE TRIM(ml.media_id) = TRIM(a.media_id)
            AND LOWER(TRIM(ml.family_group_key)) = :tenantKey
        )`;
    }

    const rows = await queryRows(
      connection,
      `SELECT
         TRIM(a.media_id) AS media_id,
         TRIM(a.file_id) AS file_id,
         LOWER(TRIM(NVL(a.storage_provider, ''))) AS storage_provider,
         NVL(TRIM(a.mime_type), '') AS mime_type,
         NVL(TRIM(a.file_name), '') AS file_name,
         NVL(TRIM(a.file_size_bytes), '') AS file_size_bytes,
         NVL(TRIM(a.media_metadata), '') AS media_metadata
       FROM media_assets a
       WHERE TRIM(NVL(a.file_id, '')) <> ''
         ${whereTenant}
       ORDER BY a.media_id`,
      binds,
    );

    const limitedRows = options.limit > 0 ? rows.slice(0, options.limit) : rows;
    stats.scanned = limitedRows.length;
    console.log(
      `[oci-object-media-migrate] mode=${options.apply ? "apply" : "dry-run"} tenant=${tenantKey || "all"} candidates=${stats.scanned}`,
    );

    for (const row of limitedRows) {
      const mediaId = normalizeText(row.MEDIA_ID);
      const fileId = normalizeText(row.FILE_ID);
      const storageProvider = normalizeText(row.STORAGE_PROVIDER).toLowerCase();
      const baseMetadata = safeParseJson(row.MEDIA_METADATA);

      if (!fileId || !mediaId) {
        stats.skippedNoFileId += 1;
        continue;
      }

      const existingObjectKey = normalizeText(baseMetadata?.objectStorage?.originalObjectKey || baseMetadata?.objectStorage?.objectKey);
      if (storageProvider === "oci_object" && existingObjectKey) {
        stats.skippedAlreadyMigrated += 1;
        continue;
      }

      try {
        const metadataRes = await drive.files.get({
          fileId,
          fields: "id,name,mimeType,size,md5Checksum",
          supportsAllDrives: true,
        });
        const contentRes = await drive.files.get(
          {
            fileId,
            alt: "media",
            supportsAllDrives: true,
          },
          { responseType: "arraybuffer" },
        );

        const sourceMimeType = normalizeText(metadataRes.data.mimeType) || "application/octet-stream";
        const sourceFileName = normalizeText(metadataRes.data.name) || row.FILE_NAME || fileId;
        const sourceBuffer = Buffer.from(contentRes.data);
        const sourceSizeBytes = sourceBuffer.length;

        const originalExt = getExtensionFromFileName(sourceFileName) || getExtensionFromMimeType(sourceMimeType);
        const safeName = sanitizeObjectNameSegment(path.basename(sourceFileName, path.extname(sourceFileName)));
        const originalObjectKey = `${objectConfig.objectPrefix}/original/${sanitizeObjectNameSegment(mediaId)}/${safeName}.${originalExt}`;

        const thumbnail = await createThumbnailIfImage(sourceBuffer, sourceMimeType);
        const thumbnailObjectKey = thumbnail
          ? `${objectConfig.objectPrefix}/thumb/${sanitizeObjectNameSegment(mediaId)}/${safeName}_thumb.${thumbnail.extension}`
          : "";

        if (options.apply) {
          await objectStorage.putObject({
            namespaceName: objectConfig.namespace,
            bucketName: objectConfig.bucketName,
            objectName: originalObjectKey,
            putObjectBody: sourceBuffer,
            contentType: sourceMimeType,
            contentLength: sourceSizeBytes,
          });

          if (thumbnail) {
            await objectStorage.putObject({
              namespaceName: objectConfig.namespace,
              bucketName: objectConfig.bucketName,
              objectName: thumbnailObjectKey,
              putObjectBody: thumbnail.buffer,
              contentType: thumbnail.mimeType,
              contentLength: thumbnail.sizeBytes,
            });
          }

          const mergedMetadata = buildMigrationMetadata({
            baseMetadata,
            fileId,
            namespace: objectConfig.namespace,
            bucketName: objectConfig.bucketName,
            originalObjectKey,
            thumbnailObjectKey,
            thumbnailMimeType: thumbnail?.mimeType || "",
            thumbnailWidth: thumbnail?.width || 0,
            thumbnailHeight: thumbnail?.height || 0,
            thumbnailSizeBytes: thumbnail?.sizeBytes || 0,
          });

          await connection.execute(
            `UPDATE media_assets
             SET storage_provider = :storageProvider,
                 mime_type = :mimeType,
                 file_name = :fileName,
                 file_size_bytes = :fileSizeBytes,
                 media_metadata = :mediaMetadata
             WHERE TRIM(media_id) = :mediaId`,
            {
              storageProvider: "oci_object",
              mimeType: sourceMimeType,
              fileName: sourceFileName,
              fileSizeBytes: String(sourceSizeBytes),
              mediaMetadata: JSON.stringify(mergedMetadata),
              mediaId,
            },
            { autoCommit: false },
          );
        }

        if (thumbnail) {
          stats.thumbnailsCreated += 1;
        }
        stats.migrated += 1;
      } catch (error) {
        stats.failed += 1;
        failures.push({
          mediaId,
          fileId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (options.apply) {
      await connection.commit();
    }
  } finally {
    await connection.close();
  }

  console.log("[oci-object-media-migrate] summary", stats);
  if (failures.length > 0) {
    console.log("[oci-object-media-migrate] failures");
    for (const item of failures.slice(0, 200)) {
      console.log(`- mediaId=${item.mediaId} fileId=${item.fileId} message=${item.message}`);
    }
    if (failures.length > 200) {
      console.log(`... ${failures.length - 200} more failures not shown`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[oci-object-media-migrate] fatal", error);
  process.exit(1);
});

