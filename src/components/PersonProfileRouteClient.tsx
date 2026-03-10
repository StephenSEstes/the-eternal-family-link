"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");

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
        onClose={() => router.push(peopleHref)}
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
            router.push(`${peopleHref}/${encodeURIComponent(nextPersonId)}`);
          }
        }}
      />
    </>
  );
}
