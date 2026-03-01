"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AddPersonCard } from "@/components/AddPersonCard";
import { HouseholdEditModal } from "@/components/HouseholdEditModal";
import { PersonEditModal } from "@/components/PersonEditModal";
import { getPhotoProxyPath } from "@/lib/google/photo-path";

type PersonItem = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickName?: string;
  birthDate: string;
  gender: "male" | "female" | "unspecified";
  photoFileId: string;
  phones?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
};

type PeopleDirectoryProps = {
  tenantKey: string;
  canManage: boolean;
  people: PersonItem[];
  photoByPersonId: Record<string, string>;
  edges: { id: string; fromPersonId: string; toPersonId: string; label: string }[];
  households: { id: string; partner1PersonId: string; partner2PersonId: string }[];
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5" />
    </svg>
  );
}

function BirthdayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M12 8V3M8 8V5.5A1.5 1.5 0 0 1 9.5 4h.5v4M16 8V5.5A1.5 1.5 0 0 0 14.5 4H14v4" />
      <path d="M3 12h18" />
    </svg>
  );
}

function normalizeDateLabel(value: string) {
  const raw = value.trim();
  if (!raw) return "Birthdate not set";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function PeopleDirectory({
  tenantKey,
  canManage,
  people,
  photoByPersonId,
  edges,
  households,
}: PeopleDirectoryProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return people;
    }
    return people.filter((person) => person.displayName.toLowerCase().includes(normalized));
  }, [people, query]);
  const selectedPerson = useMemo(
    () => people.find((item) => item.personId === selectedPersonId) ?? null,
    [people, selectedPersonId],
  );

  return (
    <main className="section">
      <section className="people-hero">
        <div>
          <h1 className="page-title">Family Members</h1>
          <p className="page-subtitle">Keep your family story alive.</p>
        </div>
        <AddPersonCard tenantKey={tenantKey} canManage={canManage} compact />
      </section>

      <label className="search-wrap" htmlFor="people-search">
        <span className="search-icon">
          <SearchIcon />
        </span>
        <input
          id="people-search"
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search family members"
        />
      </label>

      <section className="people-grid album-grid">
        {filtered.map((person) => {
          const photoFileId = photoByPersonId[person.personId] || person.photoFileId;
          const fallbackAvatar =
            person.gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png";
          return (
            <article
              key={person.personId}
              className="person-card album-card"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedPersonId(person.personId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedPersonId(person.personId);
                }
              }}
            >
              <div className="person-photo-wrap">
                <img
                  src={photoFileId ? getPhotoProxyPath(photoFileId, tenantKey) : fallbackAvatar}
                  alt={person.displayName}
                  className="person-photo"
                />
              </div>

              <div className="person-card-content">
                <h3>{person.displayName}</h3>
                <p className="person-meta-row">
                  <span className="person-meta-icon">
                    <BirthdayIcon />
                  </span>
                  <span>{normalizeDateLabel(person.birthDate)}</span>
                </p>
              </div>
            </article>
          );
        })}
      </section>

      <PersonEditModal
        open={Boolean(selectedPerson)}
        tenantKey={tenantKey}
        canManage={canManage}
        person={selectedPerson}
        people={people}
        edges={edges}
        households={households}
        onClose={() => setSelectedPersonId("")}
        onSaved={() => router.refresh()}
        onEditHousehold={(householdId) => setSelectedHouseholdId(householdId)}
      />
      <HouseholdEditModal
        open={Boolean(selectedHouseholdId)}
        tenantKey={tenantKey}
        householdId={selectedHouseholdId}
        onClose={() => setSelectedHouseholdId("")}
        onSaved={() => router.refresh()}
      />
    </main>
  );
}
