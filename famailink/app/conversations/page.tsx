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

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const session = await getSessionFromCookieStore();
  if (!session) redirect("/login");

  const params = await searchParams;
  const [circles, people, relatedPeople] = await Promise.all([
    listConversationCirclesForPerson(session.personId),
    listPeopleLite(),
    listRelatedFamilyPeople(session.personId),
  ]);
  const peopleByRelationship = new Map<string, Set<string>>();
  for (const person of relatedPeople) {
    for (const relationship of person.relationships) {
      const current = peopleByRelationship.get(relationship.category) ?? new Set<string>();
      current.add(person.personId);
      peopleByRelationship.set(relationship.category, current);
    }
  }
  const relationshipOptions = [
    {
      key: "everyone",
      label: "Everyone",
      personIds: people.filter((person) => person.personId !== session.personId).map((person) => person.personId),
    },
    ...CATEGORY_ORDER.filter((category) => category !== "self").map((category) => ({
      key: category,
      label: CATEGORY_LABELS[category],
      personIds: Array.from(peopleByRelationship.get(category) ?? []),
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
