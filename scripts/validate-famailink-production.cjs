#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://famailink-mvp.vercel.app";
const DEFAULT_PERSON_ID = "p-ae4081ae";
const DEFAULT_ENV_FILE = path.join(process.cwd(), "famailink", ".env.vercel-prod.tmp");
const REQUIRED_SCOPE_KEYS = ["vitals", "stories", "media", "conversations"];

function parseArgs(argv) {
  const options = {
    baseUrl: "",
    personId: "",
    envFile: process.env.FAMAILINK_VALIDATION_ENV_FILE || DEFAULT_ENV_FILE,
    writeRestore: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--write-restore") {
      options.writeRestore = true;
    } else if (arg === "--base-url") {
      options.baseUrl = String(argv[++index] || "");
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--person-id") {
      options.personId = String(argv[++index] || "");
    } else if (arg.startsWith("--person-id=")) {
      options.personId = arg.slice("--person-id=".length);
    } else if (arg === "--env-file") {
      options.envFile = String(argv[++index] || "");
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.personId = options.personId.trim();
  return options;
}

function usage() {
  return [
    "Usage: node scripts/validate-famailink-production.cjs [options]",
    "",
    "Options:",
    "  --base-url <url>       Production URL to validate. Defaults to https://famailink-mvp.vercel.app.",
    "  --person-id <id>       Viewer person_id for the signed validation session.",
    "  --env-file <path>      Optional env file used only for session secret values.",
    "  --write-restore        Also run reversible person-exception write checks.",
    "  --help                 Show this help.",
    "",
    "Required auth input:",
    "  FAMAILINK_SESSION_SECRET or UNIT1_SESSION_SECRET must be in the environment",
    "  or in the optional env file.",
  ].join("\n");
}

function loadSessionEnv(envFile) {
  if (!envFile || !fs.existsSync(envFile)) return;
  const allowedKeys = new Set([
    "FAMAILINK_SESSION_SECRET",
    "UNIT1_SESSION_SECRET",
    "FAMAILINK_VALIDATION_PERSON_ID",
    "FAMAILINK_PROD_BASE_URL",
  ]);
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!match || !allowedKeys.has(match[1])) continue;
    if (process.env[match[1]]) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function sessionSecret() {
  const secret = (process.env.FAMAILINK_SESSION_SECRET || process.env.UNIT1_SESSION_SECRET || "").trim();
  if (!secret) {
    throw new Error("Missing FAMAILINK_SESSION_SECRET or UNIT1_SESSION_SECRET.");
  }
  return secret;
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payloadPart, secret) {
  return crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function buildSessionCookie(personId, secret) {
  const payload = {
    userEmail: "validation@famailink.local",
    username: "production-validation",
    personId,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
  const payloadPart = base64Url(JSON.stringify(payload));
  return `${payloadPart}.${signPayload(payloadPart, secret)}`;
}

function simplifySubscriptionRows(rows) {
  return rows
    .map((row) => ({
      targetPersonId: String(row.targetPersonId || "").trim(),
      effect: String(row.effect || "").trim(),
    }))
    .filter((row) => row.targetPersonId && row.effect)
    .sort((left, right) => `${left.targetPersonId}:${left.effect}`.localeCompare(`${right.targetPersonId}:${right.effect}`));
}

function simplifySharingRows(rows) {
  return rows
    .map((row) => ({
      targetPersonId: String(row.targetPersonId || "").trim(),
      effect: String(row.effect || "").trim(),
      shareVitals: row.shareVitals ?? null,
      shareStories: row.shareStories ?? null,
      shareMedia: row.shareMedia ?? null,
      shareConversations: row.shareConversations ?? null,
    }))
    .filter((row) => row.targetPersonId && row.effect)
    .sort((left, right) => `${left.targetPersonId}:${left.effect}`.localeCompare(`${right.targetPersonId}:${right.effect}`));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class Validator {
  constructor(options) {
    this.options = options;
    this.secret = sessionSecret();
    this.viewerCookie = buildSessionCookie(options.personId, this.secret);
    this.failures = [];
    this.warnings = [];
    this.context = {};
  }

  log(status, name, detail = "") {
    const suffix = detail ? ` - ${detail}` : "";
    console.log(`[${status}] ${name}${suffix}`);
  }

  pass(name, detail = "") {
    this.log("PASS", name, detail);
  }

  warn(name, detail = "") {
    this.warnings.push({ name, detail });
    this.log("WARN", name, detail);
  }

  fail(name, detail = "") {
    this.failures.push({ name, detail });
    this.log("FAIL", name, detail);
  }

  assert(name, condition, detail = "") {
    if (condition) {
      this.pass(name, detail);
      return true;
    }
    this.fail(name, detail);
    return false;
  }

  async request(pathname, init = {}, cookie = this.viewerCookie) {
    const response = await fetch(`${this.options.baseUrl}${pathname}`, {
      redirect: "manual",
      ...init,
      headers: {
        ...(cookie ? { cookie: `famailink_session=${cookie}` } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    if ((response.headers.get("content-type") || "").includes("application/json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { response, text, body };
  }

  async expectRoute(name, pathname, expectedStatuses, options = {}) {
    const result = await this.request(pathname, { method: "GET" }, options.signedOut ? "" : undefined);
    const ok = expectedStatuses.includes(result.response.status);
    const markerOk = options.marker ? result.text.includes(options.marker) : true;
    this.assert(name, ok && markerOk, `status=${result.response.status}`);
    if (ok && options.locationIncludes) {
      const location = result.response.headers.get("location") || "";
      this.assert(`${name} redirect target`, location.includes(options.locationIncludes), `location=${location || "(none)"}`);
    }
    return result;
  }

  async expectJson(name, pathname, init = {}) {
    const result = await this.request(pathname, init);
    const ok = result.response.status === 200 && result.body && typeof result.body === "object";
    this.assert(name, ok, `status=${result.response.status}`);
    return result.body || {};
  }

  relationCategories(people) {
    const categories = new Set();
    for (const person of people) {
      for (const hit of person.relationships || []) {
        if (hit && hit.category) categories.add(hit.category);
      }
    }
    return categories;
  }

  findPreviewTarget(people) {
    return people.find((person) => person.personId !== this.options.personId && (person.relationships || []).length > 0) || null;
  }

  async runReadOnlyChecks() {
    await this.expectRoute("login loads", "/login", [200], { signedOut: true, marker: "Sign In" });
    await this.expectRoute("signed-out tree redirects", "/tree", [302, 307, 308], {
      signedOut: true,
      locationIncludes: "/login",
    });
    await this.expectRoute("authenticated tree loads", "/tree", [200], { marker: "Family Tree" });
    await this.expectRoute("authenticated administration loads", "/administration", [200], { marker: "Administration" });
    await this.expectRoute("authenticated preferences loads", "/preferences", [200], { marker: "Preferences" });
    await this.expectRoute("authenticated rules tree loads", "/rules-tree", [200], { marker: "Rules Tree" });

    const catalog = await this.expectJson("access catalog loads", "/api/access/catalog");
    const people = Array.isArray(catalog.people) ? catalog.people : [];
    const categories = this.relationCategories(people);
    this.context.catalog = catalog;
    this.context.people = people;
    this.context.target = this.findPreviewTarget(people);

    this.assert("catalog viewer matches validation person", catalog.viewerPersonId === this.options.personId, `viewer=${catalog.viewerPersonId || "(none)"}`);
    this.assert("catalog has related people", people.length > 0, `people=${people.length}`);
    this.assert("catalog has relationship categories", categories.size > 0, `categories=${Array.from(categories).sort().join(",") || "(none)"}`);
    if (!Array.from(categories).some((category) => String(category).includes("_in_law"))) {
      this.warn("catalog in-law coverage", "no in-law category present for this viewer");
    }

    if (this.context.target) {
      const preview = await this.expectJson("access preview computes", "/api/access/preview", {
        method: "POST",
        body: JSON.stringify({ targetPersonId: this.context.target.personId }),
      });
      const scopes = preview.preview?.sharing?.scopes || {};
      this.assert("preview has tree visibility result", typeof preview.preview?.tree?.visibleByNameAndRelationship === "boolean");
      this.assert("preview has subscription result", typeof preview.preview?.subscription?.isSubscribed === "boolean");
      this.assert(
        "preview has sharing scopes",
        REQUIRED_SCOPE_KEYS.every((key) => scopes[key] && typeof scopes[key].allowed === "boolean"),
        `scopes=${Object.keys(scopes).join(",") || "(none)"}`,
      );
    } else {
      this.fail("access preview computes", "no related target in catalog");
    }

    const recomputeStatus = await this.expectJson("recompute status loads", "/api/access/recompute/status");
    this.assert("latest recompute job completed", recomputeStatus.status?.latestJob?.status === "completed", `status=${recomputeStatus.status?.latestJob?.status || "(none)"}`);
    this.assert("latest recompute run completed", recomputeStatus.status?.latestRun?.status === "completed", `status=${recomputeStatus.status?.latestRun?.status || "(none)"}`);
    this.assert("visibility map summary present", (recomputeStatus.status?.summary?.visibilityRowCount || 0) > 0, `rows=${recomputeStatus.status?.summary?.visibilityRowCount ?? 0}`);
    this.assert("subscription map summary present", (recomputeStatus.status?.summary?.subscriptionRowCount || 0) > 0, `rows=${recomputeStatus.status?.summary?.subscriptionRowCount ?? 0}`);

    const subscriptionDefaults = await this.expectJson("subscription defaults load", "/api/access/subscription/defaults");
    const sharingDefaults = await this.expectJson("sharing defaults load", "/api/access/sharing/defaults");
    const subscriptionExceptions = await this.expectJson("subscription exceptions load", "/api/access/subscription/exceptions/people");
    const sharingExceptions = await this.expectJson("sharing exceptions load", "/api/access/sharing/exceptions/people");
    this.assert("subscription defaults have rows", Array.isArray(subscriptionDefaults.rows) && subscriptionDefaults.rows.length > 0, `rows=${subscriptionDefaults.rows?.length ?? 0}`);
    this.assert("sharing defaults have rows", Array.isArray(sharingDefaults.rows) && sharingDefaults.rows.length > 0, `rows=${sharingDefaults.rows?.length ?? 0}`);
    this.assert("subscription exceptions shape is array", Array.isArray(subscriptionExceptions.rows), `rows=${subscriptionExceptions.rows?.length ?? "n/a"}`);
    this.assert("sharing exceptions shape is array", Array.isArray(sharingExceptions.rows), `rows=${sharingExceptions.rows?.length ?? "n/a"}`);
  }

  async putJson(pathname, payload, cookie = this.viewerCookie) {
    const result = await this.request(
      pathname,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
      cookie,
    );
    if (result.response.status !== 200) {
      throw new Error(`${pathname} returned ${result.response.status}`);
    }
    return result.body || {};
  }

  async previewFor(viewerPersonId, targetPersonId) {
    const cookie = viewerPersonId === this.options.personId ? this.viewerCookie : buildSessionCookie(viewerPersonId, this.secret);
    const result = await this.request(
      "/api/access/preview",
      {
        method: "POST",
        body: JSON.stringify({ targetPersonId }),
      },
      cookie,
    );
    if (result.response.status !== 200 || !result.body?.preview) {
      throw new Error(`preview failed for viewer=${viewerPersonId} target=${targetPersonId}`);
    }
    return result.body.preview;
  }

  async runWriteRestoreChecks() {
    const people = this.context.people || [];
    const subscriptionTarget = this.context.target;
    if (!subscriptionTarget) {
      this.fail("write/restore subscription target", "no related target in catalog");
      return;
    }

    const originalSubscription = await this.expectJson(
      "capture subscription exceptions before write",
      "/api/access/subscription/exceptions/people",
    );
    const originalSharing = await this.expectJson("capture sharing exceptions before write", "/api/access/sharing/exceptions/people");
    const originalSubscriptionPayload = simplifySubscriptionRows(originalSubscription.rows || []);
    const originalSharingPayload = simplifySharingRows(originalSharing.rows || []);

    let restoredSubscription = false;
    let restoredSharing = false;

    try {
      const testSubscriptionPayload = originalSubscriptionPayload
        .filter((row) => row.targetPersonId !== subscriptionTarget.personId)
        .concat([{ targetPersonId: subscriptionTarget.personId, effect: "deny" }]);
      await this.putJson("/api/access/subscription/exceptions/people", testSubscriptionPayload);
      const deniedPreview = await this.previewFor(this.options.personId, subscriptionTarget.personId);
      this.assert(
        "subscription exception deny affects preview",
        deniedPreview.subscription?.isSubscribed === false && deniedPreview.subscription?.source === "subscription_person_exception_deny",
        `source=${deniedPreview.subscription?.source || "(none)"}`,
      );
    } finally {
      await this.putJson("/api/access/subscription/exceptions/people", originalSubscriptionPayload);
      restoredSubscription = true;
    }

    const sharingTarget = await this.findReverseVisibleSharingTarget(people);
    if (!sharingTarget) {
      this.warn("write/restore sharing target", "no reverse-visible target found");
    } else {
      try {
        const testSharingPayload = originalSharingPayload
          .filter((row) => row.targetPersonId !== sharingTarget.personId)
          .concat([
            {
              targetPersonId: sharingTarget.personId,
              effect: "allow",
              shareVitals: null,
              shareStories: null,
              shareMedia: null,
              shareConversations: null,
            },
          ]);
        await this.putJson("/api/access/sharing/exceptions/people", testSharingPayload);
        const allowedPreview = await this.previewFor(sharingTarget.personId, this.options.personId);
        const scopes = allowedPreview.sharing?.scopes || {};
        this.assert(
          "sharing exception allow affects reverse preview",
          REQUIRED_SCOPE_KEYS.every((key) => scopes[key]?.source === "share_person_exception_allow"),
          `sources=${REQUIRED_SCOPE_KEYS.map((key) => `${key}:${scopes[key]?.source || "(none)"}`).join(",")}`,
        );
      } finally {
        await this.putJson("/api/access/sharing/exceptions/people", originalSharingPayload);
        restoredSharing = true;
      }
    }

    const restoredSubscriptionRows = await this.expectJson(
      "subscription exceptions load after restore",
      "/api/access/subscription/exceptions/people",
    );
    const restoredSharingRows = await this.expectJson("sharing exceptions load after restore", "/api/access/sharing/exceptions/people");
    this.assert(
      "subscription exceptions restored",
      restoredSubscription && sameJson(simplifySubscriptionRows(restoredSubscriptionRows.rows || []), originalSubscriptionPayload),
      `rows=${restoredSubscriptionRows.rows?.length ?? 0}`,
    );
    this.assert(
      "sharing exceptions restored",
      restoredSharing && sameJson(simplifySharingRows(restoredSharingRows.rows || []), originalSharingPayload),
      `rows=${restoredSharingRows.rows?.length ?? 0}`,
    );

    const recomputeStatus = await this.expectJson("recompute status loads after write/restore", "/api/access/recompute/status");
    this.assert("post-write recompute completed", recomputeStatus.status?.latestRun?.status === "completed", `status=${recomputeStatus.status?.latestRun?.status || "(none)"}`);
  }

  async findReverseVisibleSharingTarget(people) {
    for (const candidate of people) {
      if (!candidate.personId || candidate.personId === this.options.personId) continue;
      try {
        const preview = await this.previewFor(candidate.personId, this.options.personId);
        if (preview.tree?.visibleByNameAndRelationship) {
          return candidate;
        }
      } catch {
        // Keep scanning; not every related person must be able to preview the owner.
      }
    }
    return null;
  }

  async run() {
    console.log(`Famailink production validation`);
    console.log(`Base URL: ${this.options.baseUrl}`);
    console.log(`Viewer person: ${this.options.personId}`);
    console.log(`Mode: ${this.options.writeRestore ? "read-only + write/restore" : "read-only"}`);
    console.log("");

    await this.runReadOnlyChecks();
    if (this.options.writeRestore) {
      console.log("");
      console.log("Write/restore checks");
      await this.runWriteRestoreChecks();
    }

    console.log("");
    console.log(`Warnings: ${this.warnings.length}`);
    console.log(`Failures: ${this.failures.length}`);
    console.log(`Overall: ${this.failures.length ? "FAIL" : "PASS"}`);

    if (this.failures.length) {
      process.exitCode = 1;
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  loadSessionEnv(options.envFile);
  options.personId = (options.personId || process.env.FAMAILINK_VALIDATION_PERSON_ID || DEFAULT_PERSON_ID).trim();
  options.baseUrl = (options.baseUrl || process.env.FAMAILINK_PROD_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const validator = new Validator(options);
  await validator.run();
}

main().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
});
