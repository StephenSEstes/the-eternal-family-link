import { redirect } from "next/navigation";
import { getSessionFromCookieStore } from "@/lib/auth/session";
import { listConversationCirclesForPerson } from "@/lib/conversations/store";
import { CATEGORY_LABELS, CATEGORY_ORDER, listPeopleLite, listRelatedFamilyPeople } from "@/lib/family/store";
import { ConversationsClient } from "@/components/ConversationsClient";

type ConversationsPageProps = {
  searchParams: Promise<{
    circleId?: string;
    conversationId?: string;
  }>;
};

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function addToSet(map: Map<string, Set<string>>, key: string, personId: string) {
  const current = map.get(key) ?? new Set<string>();
  current.add(personId);
  map.set(key, current);
}

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const session = await getSessionFromCookieStore();
  if (!session) redirect("/login");

  const params = await searchParams;
  const [circles, people, relatedPeople] = await Promise.all([
    listConversationCirclesForPerson(session.personId),
    listPeopleLite(),
    listRelatedFamilyPeople(session.personId),
  ]);
  const allByRelationship = new Map<string, Set<string>>();
  const maternalByRelationship = new Map<string, Set<string>>();
  const paternalByRelationship = new Map<string, Set<string>>();
  for (const person of relatedPeople) {
    for (const relationship of person.relationships) {
      addToSet(allByRelationship, relationship.category, person.personId);
      if (relationship.lineageSides.includes("maternal") || relationship.lineageSides.includes("both")) {
        addToSet(maternalByRelationship, relationship.category, person.personId);
      }
      if (relationship.lineageSides.includes("paternal") || relationship.lineageSides.includes("both")) {
        addToSet(paternalByRelationship, relationship.category, person.personId);
      }
    }
  }
  const relationshipOptions = [
    {
      key: "everyone",
      label: "Everyone",
      personIds: people.filter((person) => person.personId !== session.personId).map((person) => person.personId),
      maternalPersonIds: [] as string[],
      paternalPersonIds: [] as string[],
      supportsSides: false,
    },
    ...CATEGORY_ORDER.filter((category) => category !== "self").map((category) => ({
      key: category,
      label: CATEGORY_LABELS[category],
      personIds: Array.from(allByRelationship.get(category) ?? []),
      maternalPersonIds: Array.from(maternalByRelationship.get(category) ?? []),
      paternalPersonIds: Array.from(paternalByRelationship.get(category) ?? []),
      supportsSides:
        (maternalByRelationship.get(category)?.size ?? 0) > 0 || (paternalByRelationship.get(category)?.size ?? 0) > 0,
    })),
  ].filter((option) => option.personIds.length > 0);

  return (
    <ConversationsClient
      session={{
        username: session.username,
        personId: session.personId,
      }}
      initialCircles={circles}
      initialCircleId={normalize(params.circleId)}
      initialConversationId={normalize(params.conversationId)}
      people={people.map((person) => ({
        personId: person.personId,
        displayName: person.displayName,
      }))}
      relationshipOptions={relationshipOptions}
    />
  );
}
