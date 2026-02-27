"use client";

import { useEffect, useMemo, useState } from "react";

type FocusPerson = {
  personId: string;
  displayName: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  birthDate?: string;
};

type FocusPanelProps = {
  selectedPerson: FocusPerson;
  parents: FocusPerson[];
  spouses: FocusPerson[];
  childrenList: FocusPerson[];
  getAvatarUrl: (person: FocusPerson) => string;
  onSelectPerson: (personId: string) => void;
  onClose: () => void;
};

type TabKey = "parents" | "spouse" | "children";

function tabLabel(tab: TabKey) {
  if (tab === "parents") return "Parents";
  if (tab === "spouse") return "Spouse";
  return "Children";
}

function lifespanLabel(person: FocusPerson) {
  return person.birthDate?.trim() ? `Born ${person.birthDate.trim()}` : "";
}

export function FocusPanel({
  selectedPerson,
  parents,
  spouses,
  childrenList,
  getAvatarUrl,
  onSelectPerson,
  onClose,
}: FocusPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("parents");

  useEffect(() => {
    setActiveTab("parents");
  }, [selectedPerson.personId]);

  const activeList = useMemo(() => {
    if (activeTab === "parents") return parents;
    if (activeTab === "spouse") return spouses;
    return childrenList;
  }, [activeTab, childrenList, parents, spouses]);

  return (
    <aside className="tree-focus-panel" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="tree-focus-close" onClick={onClose} aria-label="Close focus mode">
        X
      </button>

      <div className="tree-focus-header">
        <img className="tree-focus-avatar" src={getAvatarUrl(selectedPerson)} alt={selectedPerson.displayName} />
        <h3>{selectedPerson.displayName}</h3>
        {lifespanLabel(selectedPerson) ? <p>{lifespanLabel(selectedPerson)}</p> : null}
      </div>

      <div className="tree-focus-tabs" role="tablist" aria-label="Relationships">
        {(["parents", "spouse", "children"] as TabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            className={`tree-focus-tab ${activeTab === tab ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab)}
            aria-selected={activeTab === tab}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      <div className="tree-focus-list" role="tabpanel">
        {activeList.length === 0 ? <p className="tree-focus-empty">No related people in this view.</p> : null}
        {activeList.map((person) => (
          <button
            key={`${activeTab}-${person.personId}`}
            type="button"
            className="tree-focus-item"
            onClick={() => onSelectPerson(person.personId)}
          >
            <img src={getAvatarUrl(person)} alt={person.displayName} />
            <span>{person.displayName}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
