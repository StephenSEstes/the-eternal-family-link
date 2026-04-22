import { redirect } from "next/navigation";
import { getSessionFromCookieStore } from "@/lib/auth/session";
import { listConversationCirclesForPerson } from "@/lib/conversations/store";
import { listPeopleLite } from "@/lib/family/store";
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
  const [circles, people] = await Promise.all([
    listConversationCirclesForPerson(session.personId),
    listPeopleLite(),
  ]);

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
    />
  );
}
