import "server-only";

import { randomUUID } from "node:crypto";
import { computeDerivedMapsForViewer } from "@/lib/access/preview";
import {
  buildDerivedSummary,
  createRecomputeRun,
  enqueueRecomputeJob,
  listProfileSubscriptionMap,
  listProfileVisibilityMap,
  listRecomputeJobs,
  listRecomputeRuns,
  replaceProfileSubscriptionMap,
  replaceProfileVisibilityMap,
  updateRecomputeJob,
} from "@/lib/access/store";
import type { AccessRecomputeRun, AccessRecomputeStatus } from "@/lib/access/types";

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function visibilityRowsEqual(
  left: Awaited<ReturnType<typeof listProfileVisibilityMap>>[number],
  right: Awaited<ReturnType<typeof listProfileVisibilityMap>>[number],
) {
  return (
    left.targetPersonId === right.targetPersonId &&
    left.treeVisible === right.treeVisible &&
    left.canVitals === right.canVitals &&
    left.canStories === right.canStories &&
    left.canMedia === right.canMedia &&
    left.canConversations === right.canConversations &&
    left.placeholderOnly === right.placeholderOnly &&
    left.reasonCode === right.reasonCode
  );
}

function subscriptionRowsEqual(
  left: Awaited<ReturnType<typeof listProfileSubscriptionMap>>[number],
  right: Awaited<ReturnType<typeof listProfileSubscriptionMap>>[number],
) {
  return (
    left.targetPersonId === right.targetPersonId &&
    left.isSubscribed === right.isSubscribed &&
    left.reasonCode === right.reasonCode
  );
}

function countChangedTargets(input: {
  previousVisibilityRows: Awaited<ReturnType<typeof listProfileVisibilityMap>>;
  previousSubscriptionRows: Awaited<ReturnType<typeof listProfileSubscriptionMap>>;
  nextVisibilityRows: Awaited<ReturnType<typeof computeDerivedMapsForViewer>>["visibilityRows"];
  nextSubscriptionRows: Awaited<ReturnType<typeof computeDerivedMapsForViewer>>["subscriptionRows"];
}) {
  const changedTargets = new Set<string>();
  const previousVisibilityByTarget = new Map(input.previousVisibilityRows.map((row) => [row.targetPersonId, row]));
  const previousSubscriptionByTarget = new Map(input.previousSubscriptionRows.map((row) => [row.targetPersonId, row]));
  const nextVisibilityByTarget = new Map(input.nextVisibilityRows.map((row) => [row.targetPersonId, row]));
  const nextSubscriptionByTarget = new Map(input.nextSubscriptionRows.map((row) => [row.targetPersonId, row]));

  const targetIds = new Set<string>([
    ...previousVisibilityByTarget.keys(),
    ...previousSubscriptionByTarget.keys(),
    ...nextVisibilityByTarget.keys(),
    ...nextSubscriptionByTarget.keys(),
  ]);

  for (const targetPersonId of targetIds) {
    const previousVisibility = previousVisibilityByTarget.get(targetPersonId);
    const nextVisibility = nextVisibilityByTarget.get(targetPersonId);
    const previousSubscription = previousSubscriptionByTarget.get(targetPersonId);
    const nextSubscription = nextSubscriptionByTarget.get(targetPersonId);

    const visibilityChanged =
      (previousVisibility == null) !== (nextVisibility == null) ||
      (previousVisibility != null &&
        nextVisibility != null &&
        !visibilityRowsEqual(previousVisibility, { ...nextVisibility, mapId: "" }));
    if (visibilityChanged) {
      changedTargets.add(targetPersonId);
      continue;
    }

    const subscriptionChanged =
      (previousSubscription == null) !== (nextSubscription == null) ||
      (previousSubscription != null &&
        nextSubscription != null &&
        !subscriptionRowsEqual(previousSubscription, { ...nextSubscription, mapId: "" }));
    if (subscriptionChanged) {
      changedTargets.add(targetPersonId);
    }
  }

  return changedTargets.size;
}

export async function runViewerRecompute(input: { viewerPersonId: string; reason?: string }) {
  const viewerPersonId = normalize(input.viewerPersonId);
  if (!viewerPersonId) {
    throw new Error("viewer_person_id_required");
  }

  const queuedJob = await enqueueRecomputeJob({
    viewerPersonId,
    reason: input.reason ?? "manual",
    dedupeKey: `${viewerPersonId}:${normalize(input.reason ?? "manual").toLowerCase() || "manual"}`,
  });

  const startedAt = nowIso();
  await updateRecomputeJob(queuedJob.jobId, {
    status: "running",
    startedAt,
    completedAt: "",
    errorMessage: "",
  });

  const runId = `fm-run-${randomUUID()}`;
  try {
    const [previousVisibilityRows, previousSubscriptionRows, computed] = await Promise.all([
      listProfileVisibilityMap(viewerPersonId),
      listProfileSubscriptionMap(viewerPersonId),
      computeDerivedMapsForViewer(viewerPersonId),
    ]);

    await Promise.all([
      replaceProfileVisibilityMap(viewerPersonId, computed.visibilityRows),
      replaceProfileSubscriptionMap(viewerPersonId, computed.subscriptionRows),
    ]);

    const completedAt = nowIso();
    const changedCount = countChangedTargets({
      previousVisibilityRows,
      previousSubscriptionRows,
      nextVisibilityRows: computed.visibilityRows,
      nextSubscriptionRows: computed.subscriptionRows,
    });

    const run: AccessRecomputeRun = {
      runId,
      jobId: queuedJob.jobId,
      viewerPersonId,
      status: "completed",
      startedAt,
      completedAt,
      processedCount: computed.visibilityRows.length,
      changedCount,
      errorMessage: "",
    };

    await createRecomputeRun(run);
    await updateRecomputeJob(queuedJob.jobId, {
      status: "completed",
      completedAt,
      errorMessage: "",
    });

    return {
      job: {
        ...queuedJob,
        status: "completed" as const,
        startedAt,
        completedAt,
      },
      run,
      summary: await buildDerivedSummary(viewerPersonId),
    };
  } catch (error) {
    const completedAt = nowIso();
    const message = error instanceof Error ? error.message : "unknown_error";
    const run: AccessRecomputeRun = {
      runId,
      jobId: queuedJob.jobId,
      viewerPersonId,
      status: "failed",
      startedAt,
      completedAt,
      processedCount: 0,
      changedCount: 0,
      errorMessage: message.slice(0, 3900),
    };

    await createRecomputeRun(run);
    await updateRecomputeJob(queuedJob.jobId, {
      status: "failed",
      completedAt,
      errorMessage: message.slice(0, 3900),
    });
    throw error;
  }
}

export async function getRecomputeStatus(viewerPersonId: string): Promise<AccessRecomputeStatus> {
  const [jobs, runs, summary] = await Promise.all([
    listRecomputeJobs(viewerPersonId),
    listRecomputeRuns(viewerPersonId),
    buildDerivedSummary(viewerPersonId),
  ]);

  return {
    latestJob: jobs[0] ?? null,
    latestRun: runs[0] ?? null,
    summary,
  };
}
