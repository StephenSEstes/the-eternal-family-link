import { redirect } from "next/navigation";
import { getRecomputeStatus } from "@/lib/access/recompute";
import { listProfileSubscriptionMap, listProfileVisibilityMap } from "@/lib/access/store";
import { getSessionFromCookieStore } from "@/lib/auth/session";
import { buildTreeLabSnapshot } from "@/lib/family/store";
import { TreeClient } from "@/components/TreeClient";

export default async function TreePage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect("/login");

  const [snapshot, recomputeStatus, visibilityRows, subscriptionRows] = await Promise.all([
    buildTreeLabSnapshot(session.personId),
    getRecomputeStatus(session.personId),
    listProfileVisibilityMap(session.personId),
    listProfileSubscriptionMap(session.personId),
  ]);

  return (
    <TreeClient
      session={{
        username: session.username,
        personId: session.personId,
      }}
      snapshot={snapshot}
      recomputeStatus={recomputeStatus}
      visibilityRows={visibilityRows}
      subscriptionRows={subscriptionRows}
    />
  );
}
