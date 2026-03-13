import "server-only";

import { getPeople } from "@/lib/data/runtime";
import { getTenantBasePath } from "@/lib/family-group/context";

type TenantAccess = {
  tenantKey: string;
};

export type HomeBirthdayPerson = {
  personId: string;
  displayName: string;
  birthDate: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  personBasePath: string;
};

function normalizeTenantKey(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

export async function loadHomeBirthdayPeople(accesses: TenantAccess[], activeTenantKey: string) {
  const normalizedActiveTenantKey = normalizeTenantKey(activeTenantKey);
  const orderedTenantKeys = [
    normalizedActiveTenantKey,
    ...accesses.map((entry) => normalizeTenantKey(entry.tenantKey)).filter(Boolean),
  ].filter((value, index, list) => list.indexOf(value) === index);

  const tenantPeopleSets = await Promise.all(
    orderedTenantKeys.map(async (tenantKey) => ({
      tenantKey,
      basePath: getTenantBasePath(tenantKey),
      people: await getPeople(tenantKey),
    })),
  );

  const activePeople = tenantPeopleSets.find((entry) => entry.tenantKey === normalizedActiveTenantKey)?.people ?? [];
  const birthdayPeopleById = new Map<string, HomeBirthdayPerson>();

  tenantPeopleSets.forEach((entry) => {
    entry.people.forEach((person) => {
      if (birthdayPeopleById.has(person.personId)) {
        return;
      }
      birthdayPeopleById.set(person.personId, {
        personId: person.personId,
        displayName: person.displayName,
        birthDate: person.birthDate,
        gender: person.gender,
        photoFileId: person.photoFileId,
        personBasePath: entry.basePath,
      });
    });
  });

  return {
    activePeople,
    birthdayPeople: Array.from(birthdayPeopleById.values()),
  };
}
