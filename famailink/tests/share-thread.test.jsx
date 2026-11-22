// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationsClient } from "@/components/ConversationsClient";

vi.mock("@/components/FamailinkChrome", () => ({ FamailinkChrome: () => null }));
vi.mock("@/components/PushNotificationsControl", () => ({ PushNotificationsControl: () => null }));

const circle = { circleId: "g", title: "Group", members: [], unreadCount: 3 };
const thread = { circleId: "g", conversationId: "t", title: "Topic", unreadCount: 3 };
const post = { postId: "p", authorPersonId: "me", caption: "First message", comments: [] };
let root, host, postLoads, receipts, deleted, media, receiptOk;
beforeEach(() => {
  postLoads = receipts = 0;
  deleted = false;
  media = null;
  receiptOk = true;
  host = document.createElement("div");
  root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
    let data;
    if (url.endsWith("/circles")) data = { circles: [circle] };
    else if (url.endsWith("/conversations")) data = { conversations: [thread] };
    else if (url.endsWith("/posts")) {
      // Bound the old feedback loop so the regression fails with a request count.
      if (++postLoads > 4) throw new Error("Repeated idle requests");
      data = { posts: deleted ? [] : [{ ...post, media }] };
    } else if (url.endsWith("/read")) { receipts++; data = { ok: receiptOk }; }
    else if (url.endsWith("/posts/p") && opts.method === "DELETE") { deleted = true; data = { ok: true }; }
    else throw new Error("Unexpected URL: " + url);
    return { ok: true, json: async () => data };
  }));
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  delete HTMLElement.prototype.scrollIntoView;
});
async function openThread() {
  await act(() => root.render(<ConversationsClient session={{ personId: "me" }} initialCircles={[circle]}
    initialCircleId="g" initialConversationId="t" people={[]} relationshipOptions={[]} />));
}
it("loads an open thread once, even after updating unread state", async () => {
  await openThread();
  expect(host.textContent).toContain("First message");
  expect({ postLoads, receipts }).toEqual({ postLoads: 1, receipts: 1 });
});
it("refreshes once after an explicit thread mutation", async () => {
  await openThread();
  await act(() => host.querySelector(".conversation-delete-post").click());
  expect(deleted).toBe(true);
  expect(host.textContent).not.toContain("First message");
  expect({ postLoads, receipts }).toEqual({ postLoads: 2, receipts: 2 });
});
it("keeps an original-only photo visible and available for tagging", async () => {
  media = { mediaKind: "image", originalUrl: "/sample.jpg", previewUrl: "", taggedPeople: [] };
  await openThread();
  expect(host.querySelector(".conversation-image-frame img")?.getAttribute("src")).toBe("/sample.jpg");
  expect(host.textContent).toContain("Add media details");
});
it.each([true, false])("only clears thread and group badges for an acknowledged read (%s)", async (ok) => {
  receiptOk = ok;
  await openThread();
  for (let i = 0; i < 2; i++) {
    await act(() => host.querySelector(".conversation-back-button").click());
    expect(host.querySelector(".conversation-unread")?.textContent ?? "").toBe(ok ? "" : "3");
  }
  expect(postLoads).toBe(1);
});
