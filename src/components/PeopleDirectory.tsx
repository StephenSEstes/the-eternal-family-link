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
  maidenName?: string;
  nickName?: string;
  birthDate: string;
  gender: "male" | "female" | "unspecified";
  photoFileId: string;
  phones?: string;
  email?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
};

type PeopleDirectoryProps = {
  tenantKey: string;
  canManage: boolean;
  people: PersonItem[];
  edges: { id: string; fromPersonId: string; toPersonId: string; label: string }[];
  households: { id: string; partner1PersonId: string; partner2PersonId: string; label?: string }[];
};

type DirectoryMode = "people" | "households";

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
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const y = match[1] ?? "";
    const m = match[2] ?? "";
    const d = match[3] ?? "";
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIndex = Number.parseInt(m, 10) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${monthNames[monthIndex]} ${Number.parseInt(d, 10)}, ${y}`;
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function PeopleDirectory({
  tenantKey,
  canManage,
  people,
  edges,
  households,
}: PeopleDirectoryProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<DirectoryMode>("people");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");
  const [returnHouseholdId, setReturnHouseholdId] = useState("");
  const peopleById = useMemo(() => new Map(people.map((person) => [person.personId, person])), [people]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return people;
    }
    return people.filter((person) => person.displayName.toLowerCase().includes(normalized));
  }, [people, query]);
  const householdCards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return households
      .map((household) => {
        const partner1 = peopleById.get(household.partner1PersonId);
        const partner2 = peopleById.get(household.partner2PersonId);
        const partner1Name = partner1?.displayName || "Unknown";
        const partner2Name = partner2?.displayName || "Unknown";
        const label = household.label?.trim() || `${partner1Name} + ${partner2Name}`;
        const searchBlob = `${label} ${partner1Name} ${partner2Name} ${household.id}`.toLowerCase();
        return {
          id: household.id,
          label,
          partner1Name,
          partner2Name,
          searchBlob,
        };
      })
      .filter((item) => (normalized ? item.searchBlob.includes(normalized) : true));
  }, [households, peopleById, query]);
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
          placeholder={mode === "people" ? "Search family members" : "Search households"}
        />
      </label>
      <div className="settings-chip-list" style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
        <button
          type="button"
          className={`button secondary tap-button ${mode === "people" ? "active" : ""}`}
          onClick={() => setMode("people")}
        >
          People
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${mode === "households" ? "active" : ""}`}
          onClick={() => setMode("households")}
        >
          Households
        </button>
      </div>

      {mode === "people" ? (
        <section className="people-grid album-grid">
          {filtered.map((person) => {
            const photoFileId = person.photoFileId;
            const fallbackAvatar =
              person.gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png";
            return (
              <article
                key={person.personId}
                className="person-card album-card"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setReturnHouseholdId("");
                  setSelectedPersonId(person.personId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setReturnHouseholdId("");
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
      ) : (
        <section className="people-grid album-grid">
          {householdCards.map((household) => (
            <article
              key={household.id}
              className="person-card album-card"
              role="button"
              tabIndex={0}
              onClick={() => {
                setReturnHouseholdId("");
                setSelectedHouseholdId(household.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setReturnHouseholdId("");
                  setSelectedHouseholdId(household.id);
                }
              }}
            >
              <div className="person-photo-wrap">
                <img src="/WeddingAvatar1.png" alt={household.label} className="person-photo" />
              </div>
              <div className="person-card-content">
                <h3>{household.label}</h3>
                <p className="person-meta-row">
                  <span>{household.partner1Name}</span>
                </p>
                <p className="person-meta-row">
                  <span>{household.partner2Name}</span>
                </p>
              </div>
            </article>
          ))}
        </section>
      )}

      <PersonEditModal
        open={Boolean(selectedPerson)}
        tenantKey={tenantKey}
        canManage={canManage}
        person={selectedPerson}
        people={people}
        edges={edges}
        households={households}
        onClose={() => {
          setSelectedPersonId("");
          if (returnHouseholdId) {
            setSelectedHouseholdId(returnHouseholdId);
            setReturnHouseholdId("");
          }
        }}
        onSaved={() => router.refresh()}
        onEditHousehold={(householdId) => setSelectedHouseholdId(householdId)}
      />
      <HouseholdEditModal
        open={Boolean(selectedHouseholdId)}
        tenantKey={tenantKey}
        householdId={selectedHouseholdId}
        onClose={() => setSelectedHouseholdId("")}
        onSaved={() => router.refresh()}
        onEditPerson={(personId) => {
          setReturnHouseholdId(selectedHouseholdId);
          setSelectedHouseholdId("");
          setSelectedPersonId(personId);
        }}
      />
    </main>
  );
}
