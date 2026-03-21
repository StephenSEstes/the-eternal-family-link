"use client";

import { useMemo, useState } from "react";
import type { PersonRecord } from "@/lib/google/types";
import { getPhotoAvatarProxyPath } from "@/lib/google/photo-path";

type ViewerPeopleGridProps = {
  people: PersonRecord[];
  tenantKey?: string;
};

export function ViewerPeopleGrid({ people, tenantKey }: ViewerPeopleGridProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return people;
    }

    return people.filter((person) => person.displayName.toLowerCase().includes(normalized));
  }, [people, query]);

  return (
    <section className="section">
      <label className="label" htmlFor="search">
        Search for a family member
      </label>
      <input
        id="search"
        className="input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Type a name"
      />

      <div className="people-grid">
        {filtered.map((person) => (
          <div key={person.personId} className="person-card">
            <img
              src={
                person.photoFileId
                  ? getPhotoAvatarProxyPath(person.photoFileId, tenantKey)
                  : person.gender === "female"
                    ? "/placeholders/avatar-female.png"
                    : "/placeholders/avatar-male.png"
              }
              alt={person.displayName}
            />
            <h3>{person.displayName}</h3>
          </div>
        ))}
      </div>
    </section>
  );
}
