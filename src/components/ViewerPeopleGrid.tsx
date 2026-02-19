"use client";

import { useMemo, useState } from "react";
import type { PersonRecord } from "@/lib/google/types";
import { getPhotoProxyPath } from "@/lib/google/photo-path";

type ViewerPeopleGridProps = {
  people: PersonRecord[];
  tenantKey?: string;
  photoByPersonId?: Record<string, string>;
};

export function ViewerPeopleGrid({ people, tenantKey, photoByPersonId }: ViewerPeopleGridProps) {
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
                (photoByPersonId?.[person.personId] || person.photoFileId)
                  ? getPhotoProxyPath(photoByPersonId?.[person.personId] || person.photoFileId, tenantKey)
                  : "/globe.svg"
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
