import "server-only";

import { getPeople } from "@/lib/data/runtime";
import { getTenantBasePath } from "@/lib/family-group/context";
import { getPersonDeathDateMapForTenant } from "@/lib/person/vital-dates-server";

type TenantAccess = {
  tenantKey: string;
  tenantName?: string;
};

export type BirthdayFamilyGroupOption = {
  tenantKey: string;
  tenantName: string;
  basePath: string;
};

export type SharedBirthdayPerson = {
  personId: string;
  displayName: string;
  birthDate: string;
  deathDate?: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  personBasePath: string;
  familyGroupKeys: string[];
};

function normalizeTenantKey(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

export async function loadBirthdayPeopleForAccessibleFamilies(accesses: TenantAccess[], activeTenantKey: string) {
  const normalizedActiveTenantKey = normalizeTenantKey(activeTenantKey);
  const orderedFamilyGroups = [
    {
      tenantKey: normalizedActiveTenantKey,
      tenantName: accesses.find((entry) => normalizeTenantKey(entry.tenantKey) === normalizedActiveTenantKey)?.tenantName ?? activeTenantKey,
    },
    ...accesses.map((entry) => ({
      tenantKey: normalizeTenantKey(entry.tenantKey),
      tenantName: entry.tenantName ?? entry.tenantKey,
    })),
  ].filter((entry, index, list) => {
    if (!entry.tenantKey) {
      return false;
    }
    return list.findIndex((candidate) => candidate.tenantKey === entry.tenantKey) === index;
  });

  const tenantPeopleSets = await Promise.all(
    orderedFamilyGroups.map(async (entry) => {
      const people = await getPeople(entry.tenantKey);
      const deathDatesByPersonId = await getPersonDeathDateMapForTenant(
        entry.tenantKey,
        people.map((person) => person.personId),
      );
      return {
        tenantKey: entry.tenantKey,
        tenantName: entry.tenantName,
        basePath: getTenantBasePath(entry.tenantKey),
        people,
        deathDatesByPersonId,
      };
    }),
  );

  const activePeople = tenantPeopleSets.find((entry) => entry.tenantKey === normalizedActiveTenantKey)?.people ?? [];
  const birthdayPeopleById = new Map<string, SharedBirthdayPerson>();

  tenantPeopleSets.forEach((entry) => {
    entry.people.forEach((person) => {
      const existing = birthdayPeopleById.get(person.personId);
      if (existing) {
        if (!existing.familyGroupKeys.includes(entry.tenantKey)) {
          existing.familyGroupKeys.push(entry.tenantKey);
        }
        return;
      }
      birthdayPeopleById.set(person.personId, {
        personId: person.personId,
        displayName: person.displayName,
        birthDate: person.birthDate,
        deathDate: entry.deathDatesByPersonId.get(person.personId) ?? "",
        gender: person.gender,
        photoFileId: person.photoFileId,
        personBasePath: entry.tenantKey === normalizedActiveTenantKey ? getTenantBasePath(normalizedActiveTenantKey) : entry.basePath,
        familyGroupKeys: [entry.tenantKey],
      });
    });
  });

  return {
    activePeople,
    familyGroups: tenantPeopleSets.map((entry) => ({
      tenantKey: entry.tenantKey,
      tenantName: entry.tenantName,
      basePath: entry.basePath,
    })) satisfies BirthdayFamilyGroupOption[],
    birthdayPeople: Array.from(birthdayPeopleById.values()),
  };
}

export const loadHomeBirthdayPeople = loadBirthdayPeopleForAccessibleFamilies;
