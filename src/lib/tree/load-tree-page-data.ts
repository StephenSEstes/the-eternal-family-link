import "server-only";

import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPeople } from "@/lib/data/runtime";
import { isTreePlacedFamilyGroupRelationshipType } from "@/lib/family-group/relationship-type";

export type TreePageData = {
  people: Awaited<ReturnType<typeof getPeople>>;
  relationships: Awaited<ReturnType<typeof getRelationships>>;
  households: Awaited<ReturnType<typeof getHouseholds>>;
};

type TreePageCacheEntry = {
  data: TreePageData;
  expiresAt: number;
};

// Disable caching to ensure tree reflects the latest person/household names after edits.
const TREE_PAGE_CACHE_TTL_MS = 0;
const treePageDataCache = new Map<string, TreePageCacheEntry>();
const inFlightTreePageLoads = new Map<string, Promise<TreePageData>>();

export async function loadTreePageData(tenantKey: string): Promise<TreePageData> {
  const cacheKey = tenantKey.trim().toLowerCase();
  const now = Date.now();
  const cached = treePageDataCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const existing = inFlightTreePageLoads.get(cacheKey);
  if (existing) {
    return existing;
  }

  const next = (async () => {
    const people = (await getPeople(tenantKey)).filter((person) =>
      isTreePlacedFamilyGroupRelationshipType(person.familyGroupRelationshipType),
    );
    const peopleInFamily = new Set(people.map((person) => person.personId));
    const [allRelationships, allHouseholds] = await Promise.all([getRelationships(tenantKey), getHouseholds(tenantKey)]);
    const relationships = allRelationships.filter(
      (rel) => peopleInFamily.has(rel.fromPersonId) && peopleInFamily.has(rel.toPersonId),
    );
    const households = allHouseholds.filter(
      (unit) =>
        peopleInFamily.has(unit.partner1PersonId) &&
        (!unit.partner2PersonId || peopleInFamily.has(unit.partner2PersonId)),
    );
    const data = { people, relationships, households };
    treePageDataCache.set(cacheKey, { data, expiresAt: Date.now() + TREE_PAGE_CACHE_TTL_MS });
    return data;
  })();

  inFlightTreePageLoads.set(cacheKey, next);
  try {
    return await next;
  } finally {
    inFlightTreePageLoads.delete(cacheKey);
  }
}
