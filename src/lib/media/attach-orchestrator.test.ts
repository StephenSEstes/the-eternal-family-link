import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHouseholdLinkPayload,
  buildHouseholdUploadContractFields,
  buildPersonAttributeLinkPayload,
  buildPersonUploadContractFields,
} from "./attach-contracts";

test("person upload contract fields stay stable", () => {
  const fields = buildPersonUploadContractFields({
    label: "Album",
    description: "Notes",
    photoDate: "2026-03-07",
    attributeType: "media",
    isHeadshot: false,
  });
  assert.deepEqual(fields, {
    label: "Album",
    description: "Notes",
    photoDate: "2026-03-07",
    isHeadshot: "false",
    attributeType: "media",
  });
});

test("household upload contract fields stay stable", () => {
  const fields = buildHouseholdUploadContractFields({
    name: "Album",
    description: "Notes",
    photoDate: "2026-03-07",
    isPrimary: false,
  });
  assert.deepEqual(fields, {
    name: "Album",
    description: "Notes",
    photoDate: "2026-03-07",
    isPrimary: "false",
  });
});

test("person attribute link payload preserves person-link semantics", () => {
  const payload = buildPersonAttributeLinkPayload({
    attributeType: "photo",
    valueText: "file-1",
    valueJson: "{\"mediaKind\":\"image\"}",
    label: "Label",
    notes: "Notes",
    startDate: "2026-03-07",
  });
  assert.equal(payload.attributeType, "photo");
  assert.equal(payload.valueText, "file-1");
  assert.equal(payload.visibility, "family");
  assert.equal(payload.shareScope, "both_families");
  assert.equal(payload.isPrimary, false);
});

test("household link payload stays stable", () => {
  const payload = buildHouseholdLinkPayload({
    fileId: "file-1",
    name: "Label",
    description: "Notes",
    photoDate: "2026-03-07",
    mediaMetadata: "{\"mediaKind\":\"image\"}",
  });
  assert.deepEqual(payload, {
    fileId: "file-1",
    name: "Label",
    description: "Notes",
    photoDate: "2026-03-07",
    mediaMetadata: "{\"mediaKind\":\"image\"}",
    isPrimary: false,
  });
});
