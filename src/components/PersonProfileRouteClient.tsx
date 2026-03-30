"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HouseholdEditModal } from "@/components/HouseholdEditModal";
import { PersonEditModal } from "@/components/PersonEditModal";

type PersonItem = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  maidenName?: string;
  nickName?: string;
  birthDate?: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  phones?: string;
  email?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
  familyGroupRelationshipType?: "founder" | "direct" | "in_law" | "undeclared";
};

type GraphEdge = {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  label: string;
};

type HouseholdLink = {
  id: string;
  partner1PersonId: string;
  partner2PersonId: string;
  label?: string;
};

type Props = {
  tenantKey: string;
  canManage: boolean;
  canManageRelationshipType?: boolean;
  person: PersonItem;
  people: PersonItem[];
  edges: GraphEdge[];
  households: HouseholdLink[];
  peopleHref: string;
};

type LaunchTab = "contact" | "attributes" | "photos";
type LaunchAction = "add-media" | "add-attribute";

function resolveReturnHref(rawValue: string | null, fallbackHref: string) {
  const candidate = (rawValue ?? "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallbackHref;
  }
  return candidate;
}

function parseLaunchTab(rawValue: string | null): LaunchTab | null {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (normalized === "contact" || normalized === "attributes" || normalized === "photos") {
    return normalized;
  }
  return null;
}

function parseLaunchAction(rawValue: string | null): LaunchAction | null {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (normalized === "add-media" || normalized === "add-attribute") {
    return normalized;
  }
  return null;
}

export function PersonProfileRouteClient({
  tenantKey,
  canManage,
  canManageRelationshipType = false,
  person,
  people,
  edges,
  households,
  peopleHref,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");
  const returnHref = resolveReturnHref(searchParams.get("returnTo"), peopleHref);
  const launchTab = parseLaunchTab(searchParams.get("tab"));
  const launchAction = parseLaunchAction(searchParams.get("action"));
  const buildPersonHref = (personId: string) => {
    const encodedPersonId = encodeURIComponent(personId);
    const encodedReturnTo = encodeURIComponent(returnHref);
    return `${peopleHref}/${encodedPersonId}?returnTo=${encodedReturnTo}`;
  };

  return (
    <>
      <PersonEditModal
        open
        tenantKey={tenantKey}
        canManage={canManage}
        canManageRelationshipType={canManageRelationshipType}
        person={person}
        people={people}
        edges={edges}
        households={households}
        launchTab={launchTab}
        launchAction={launchAction}
        onClose={() => router.push(returnHref)}
        onSaved={() => router.refresh()}
        onEditHousehold={(householdId) => setSelectedHouseholdId(householdId)}
      />
      <HouseholdEditModal
        open={Boolean(selectedHouseholdId)}
        tenantKey={tenantKey}
        householdId={selectedHouseholdId}
        onClose={() => setSelectedHouseholdId("")}
        onSaved={() => router.refresh()}
        onEditPerson={(nextPersonId) => {
          setSelectedHouseholdId("");
          if (nextPersonId && nextPersonId !== person.personId) {
            router.push(buildPersonHref(nextPersonId));
          }
        }}
      />
    </>
  );
}
