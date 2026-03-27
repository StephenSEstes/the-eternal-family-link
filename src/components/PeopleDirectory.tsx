"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AddPersonCard } from "@/components/AddPersonCard";
import { HouseholdEditModal } from "@/components/HouseholdEditModal";
import { PersonEditModal } from "@/components/PersonEditModal";
import { getPhotoAvatarProxyPath } from "@/lib/google/photo-path";

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
  familyGroupRelationshipType?: "founder" | "direct" | "in_law" | "undeclared";
};

type PersonSeed = PersonItem;

type PeopleDirectoryProps = {
  tenantKey: string;
  canManage: boolean;
  canManageRelationshipType?: boolean;
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

function PeopleModeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 11.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zm8 1a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 18.8a4.7 4.7 0 0 1 7 0M13.2 18.4a4.05 4.05 0 0 1 5.3-.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HouseholdModeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 10.4L12 4l8 6.4v8.6a1 1 0 0 1-1 1h-4.8a.7.7 0 0 1-.7-.7V14a1.5 1.5 0 0 0-3 0v5.3a.7.7 0 0 1-.7.7H5a1 1 0 0 1-1-1v-8.6z" fill="currentColor" />
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

function normalizeFamilyGroupRelationshipType(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "founder" || normalized === "direct" || normalized === "in_law" || normalized === "undeclared") {
    return normalized;
  }
  return "undeclared";
}

export function PeopleDirectory({
  tenantKey,
  canManage,
  canManageRelationshipType = false,
  people,
  edges,
  households,
}: PeopleDirectoryProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<DirectoryMode>("people");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedPersonOverride, setSelectedPersonOverride] = useState<PersonSeed | null>(null);
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
  const undeclaredPeople = useMemo(
    () => filtered.filter((person) => normalizeFamilyGroupRelationshipType(person.familyGroupRelationshipType) === "undeclared"),
    [filtered],
  );
  const placedPeople = useMemo(
    () => filtered.filter((person) => normalizeFamilyGroupRelationshipType(person.familyGroupRelationshipType) !== "undeclared"),
    [filtered],
  );
  const householdCards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return households
      .map((household) => {
        const partner1 = peopleById.get(household.partner1PersonId);
        const partner2 = peopleById.get(household.partner2PersonId);
        const partner1Name = partner1?.displayName || (household.partner1PersonId ? "Unknown" : "");
        const partner2Name = partner2?.displayName || (household.partner2PersonId ? "Unknown" : "");
        const householdPeople = [partner1Name, partner2Name].filter(Boolean);
        const label = household.label?.trim() || householdPeople.join(" + ") || household.id;
        const searchBlob = `${label} ${householdPeople.join(" ")} ${household.id}`.toLowerCase();
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
    () => {
      const person = people.find((item) => item.personId === selectedPersonId) ?? null;
      const override =
        selectedPersonOverride && selectedPersonOverride.personId === selectedPersonId
          ? selectedPersonOverride
          : null;
      if (person && override) {
        return { ...person, ...override };
      }
      return override ?? person;
    },
    [people, selectedPersonId, selectedPersonOverride],
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
          <span className="button-icon" aria-hidden="true">
            <PeopleModeIcon />
          </span>
          <span>People</span>
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${mode === "households" ? "active" : ""}`}
          onClick={() => setMode("households")}
        >
          <span className="button-icon" aria-hidden="true">
            <HouseholdModeIcon />
          </span>
          <span>Households</span>
        </button>
      </div>

      {mode === "people" ? (
        <>
          {undeclaredPeople.length > 0 ? (
            <section style={{ marginBottom: "1rem" }}>
              <div className="card person-needs-placement">
                <h2 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Needs Placement</h2>
                <p className="page-subtitle" style={{ marginTop: 0 }}>
                  These people belong to the family group but are not yet placed in the family tree.
                </p>
                <div className="people-grid album-grid">
                  {undeclaredPeople.map((person) => {
                    const photoFileId = person.photoFileId;
                    const fallbackAvatar =
                      person.gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png";
                    return (
                      <article
                        key={`undeclared-${person.personId}`}
                        className="person-card album-card person-card--needs-placement"
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
                            src={photoFileId ? getPhotoAvatarProxyPath(photoFileId, tenantKey) : fallbackAvatar}
                            alt={person.displayName}
                            className="person-photo"
                          />
                        </div>
                        <div className="person-card-content">
                          <div className="person-card-tag">Needs Placement</div>
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
                </div>
              </div>
            </section>
          ) : null}
          <section className="people-grid album-grid">
          {placedPeople.map((person) => {
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
                    src={photoFileId ? getPhotoAvatarProxyPath(photoFileId, tenantKey) : fallbackAvatar}
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
        </>
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
                {household.partner1Name ? (
                  <p className="person-meta-row">
                    <span>{household.partner1Name}</span>
                  </p>
                ) : null}
                {household.partner2Name ? (
                  <p className="person-meta-row">
                    <span>{household.partner2Name}</span>
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}

      <PersonEditModal
        open={Boolean(selectedPerson)}
        tenantKey={tenantKey}
        canManage={canManage}
        canManageRelationshipType={canManageRelationshipType}
        person={selectedPerson}
        people={people}
        edges={edges}
        households={households}
        onClose={() => {
          setSelectedPersonId("");
          setSelectedPersonOverride(null);
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
        onEditPerson={(personId, personSeed) => {
          setReturnHouseholdId(selectedHouseholdId);
          setSelectedHouseholdId("");
          setSelectedPersonOverride(
            personSeed
              ? {
                  ...personSeed,
                  birthDate: personSeed.birthDate ?? "",
                  gender: personSeed.gender ?? "unspecified",
                  photoFileId: personSeed.photoFileId ?? "",
                }
              : null,
          );
          setSelectedPersonId(personId);
        }}
      />
    </main>
  );
}
