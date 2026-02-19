import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import { getAppSession, requireSession } from "@/lib/auth/session";
import { getPersonById, updatePerson } from "@/lib/google/sheets";
import { personUpdateSchema } from "@/lib/validation/person";

type PersonRouteProps = {
  params: Promise<{ personId: string }>;
};

export async function GET(_: Request, { params }: PersonRouteProps) {
  await requireSession();
  const { personId } = await params;
  const person = await getPersonById(personId);

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  return NextResponse.json({ person });
}

export async function POST(request: Request, { params }: PersonRouteProps) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { personId } = await params;
  if (!canEditPerson(session, personId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = personUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const person = await updatePerson(personId, parsed.data);
  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  return NextResponse.json({ person });
}