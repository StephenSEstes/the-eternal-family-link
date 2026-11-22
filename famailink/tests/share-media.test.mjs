import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PATCH } from "@/app/api/conversations/circles/[circleId]/conversations/[conversationId]/posts/[postId]/tags/route";
import { POST } from "@/app/api/conversations/circles/[circleId]/conversations/[conversationId]/posts/upload/route";
import { replaceConversationPostTags, upsertConversationMediaAsset } from "@/lib/conversations/store";
import { putOciObjectByKey } from "@/lib/oci/object-storage";
import { createImageThumbnailVariant } from "@/lib/media/thumbnail.server";

vi.mock("next/server", () => ({ NextResponse: Response, after: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireRouteSession: () => ({ session: { personId: "me" } }) }));
vi.mock("@/lib/conversations/store", () => ({
  replaceConversationPostTags: vi.fn(async () => ({})),
  upsertConversationMediaAsset: vi.fn(),
  createConversationPost: vi.fn(async () => ({ postId: "post" })),
}));
vi.mock("@/lib/notifications/store", () => ({ dispatchPendingPushNotifications: vi.fn(), queueConversationActivityNotifications: vi.fn() }));
vi.mock("@/lib/media/thumbnail.server", () => ({ createImageThumbnailVariant: vi.fn() }));
vi.mock("@/lib/oci/object-storage", () => ({
  getOciObjectStorageLocation: () => ({ objectPrefix: "test" }),
  putOciObjectByKey: vi.fn(),
}));

const context = { params: Promise.resolve({ circleId: "group", conversationId: "thread", postId: "post" }) };
const details = { personIds: ["me"], label: "Reunion", description: "At home", photoDate: "2026-06-01" };
function save(body) {
  return PATCH(new Request("https://example.test", { method: "PATCH", body }), context);
}

describe("photo details replacement", () => {
  it.each([
    ["invalid JSON", "{"],
    ["old tags-only request", JSON.stringify({ personIds: [] })],
    ["missing people", JSON.stringify({ ...details, personIds: undefined })],
    ["invalid people", JSON.stringify({ ...details, personIds: [null] })],
    ["blank person", JSON.stringify({ ...details, personIds: [" "] })],
    ["invalid title", JSON.stringify({ ...details, label: null })],
  ])("rejects %s without modifying stored details or links", async (_, body) => {
    const res = await save(body);
    expect(replaceConversationPostTags).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it.each([details, { personIds: [], label: "", description: "", photoDate: "" }])("accepts an explicit replacement", async (fields) => {
    expect((await save(JSON.stringify(fields))).status).toBe(200);
    expect(replaceConversationPostTags).toHaveBeenCalledWith(expect.objectContaining(fields));
  });
});

describe("thumbnail persistence", () => {
  const source = Buffer.from("fixture-original");
  const preview = Buffer.from("fixture-preview");
  let objects;
  let failures;
  beforeEach(() => {
    objects = new Map();
    failures = 0;
    createImageThumbnailVariant.mockResolvedValue({ buffer: preview, extension: "jpg", mimeType: "image/jpeg" });
    putOciObjectByKey.mockImplementation(async ({ objectKey, data }) => {
      if (objectKey.includes("/thumb/") && failures-- > 0) throw new Error("simulated storage outage");
      objects.set(objectKey, data);
    });
  });

  async function upload(type = "image/jpeg", name = "fixture.jpg", bytes = source) {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type }), name);
    const res = await POST(new Request("https://example.test", { method: "POST", body: form }), context);
    expect(res.status).toBe(200);
    const { media, warning } = await res.json();
    expect(warning).toBe(type.startsWith("image/") && !media.thumbnailObjectKey ? "thumbnail_unavailable" : undefined);
    expect(objects.get(media.originalObjectKey)).toEqual(bytes);
    expect(upsertConversationMediaAsset).toHaveBeenCalledWith(expect.objectContaining(media));
    expect(putOciObjectByKey.mock.calls.filter(([p]) => p.objectKey.includes("/original/"))).toHaveLength(1);
    return media;
  }

  it.each([0, 1])("records a stored preview after %i temporary write failures", async (count) => {
    failures = count;
    const media = await upload();
    expect(objects.get(media.thumbnailObjectKey)).toEqual(preview);
  });
  it("stores an unmodified PNG and a smaller decodable JPEG using the real image processor", async () => {
    const actual = await vi.importActual("@/lib/media/thumbnail.server");
    createImageThumbnailVariant.mockImplementationOnce(actual.createImageThumbnailVariant);
    const bytes = await sharp({ create: { width: 1920, height: 960, channels: 3, background: "white" } }).png().toBuffer();
    const media = await upload("image/png", "sample.png", bytes);
    const output = await sharp(objects.get(media.thumbnailObjectKey)).metadata();
    expect(output.format).toBe("jpeg");
    expect(output.width).toBeLessThan(1920);
    expect(output.height).toBe(output.width / 2);
  });
  it("never records a missing preview when storage remains unavailable", async () => {
    failures = Infinity;
    const media = await upload();
    expect(media.thumbnailObjectKey).toBe("");
    expect(objects.size).toBe(1);
  });
  it("preserves originals when decoding is unsupported", async () => {
    createImageThumbnailVariant.mockRejectedValue(new Error("unsupported image"));
    expect((await upload()).thumbnailObjectKey).toBe("");
  });
  it("does not thumbnail non-image files", async () => {
    expect((await upload("application/pdf", "fixture.pdf")).thumbnailObjectKey).toBe("");
    expect(createImageThumbnailVariant).not.toHaveBeenCalled();
  });
});
