"use client";

type FocusPerson = {
  personId: string;
  displayName: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  birthDate?: string;
};

export type FocusPanelGroup = "default" | "spouses" | "siblings" | "children";

type FocusPanelProps = {
  selectedPerson: FocusPerson;
  selectedHouseholdLabel?: string;
  activeGroup: FocusPanelGroup;
  currentPeople: FocusPerson[];
  spouses: FocusPerson[];
  siblings: FocusPerson[];
  childrenList: FocusPerson[];
  hasParents: boolean;
  getAvatarUrl: (person: FocusPerson) => string;
  onActivateParents: () => void;
  onActivateSpouses: () => void;
  onActivateSiblings: () => void;
  onActivateChildren: () => void;
  onSelectPerson: (personId: string) => void;
  onClose: () => void;
};

function monthDayLabel(person: FocusPerson) {
  const raw = person.birthDate?.trim() ?? "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  return `${match[2]}-${match[3]}`;
}

function actionLabel(base: string, count: number) {
  return count > 0 ? `${base} ${count}` : base;
}

export function FocusPanel({
  selectedPerson,
  selectedHouseholdLabel = "",
  activeGroup,
  currentPeople,
  spouses,
  siblings,
  childrenList,
  hasParents,
  getAvatarUrl,
  onActivateParents,
  onActivateSpouses,
  onActivateSiblings,
  onActivateChildren,
  onSelectPerson,
  onClose,
}: FocusPanelProps) {
  const peopleChips =
    activeGroup === "siblings"
      ? siblings
      : activeGroup === "children"
        ? childrenList
        : activeGroup === "spouses"
          ? spouses
          : currentPeople;
  const birthday = monthDayLabel(selectedPerson);
  const metaBits = [birthday, selectedHouseholdLabel.trim()].filter(Boolean);

  return (
    <aside className="tree-focus-panel" onPointerDown={(event) => event.stopPropagation()}>
      <div className="tree-focus-header-compact">
        <img className="tree-focus-avatar-compact" src={getAvatarUrl(selectedPerson)} alt={selectedPerson.displayName} />
        <div className="tree-focus-header-copy">
          <h3>{selectedPerson.displayName}</h3>
          {metaBits.length > 0 ? <p>{metaBits.join(" - ")}</p> : null}
        </div>
        <button type="button" className="tree-focus-close" onClick={onClose} aria-label="Close focus mode">
          X
        </button>
      </div>

      <div className="tree-focus-actions" aria-label="Focus navigation">
        <button
          type="button"
          className="tree-focus-action-chip"
          onClick={onActivateParents}
          disabled={!hasParents}
          aria-disabled={!hasParents}
        >
          Parents
        </button>
        <button
          type="button"
          className={`tree-focus-action-chip${activeGroup === "spouses" ? " is-active" : ""}`}
          onClick={onActivateSpouses}
          disabled={spouses.length === 0}
          aria-disabled={spouses.length === 0}
        >
          {actionLabel("Spouse", spouses.length)}
        </button>
        <button
          type="button"
          className={`tree-focus-action-chip${activeGroup === "siblings" ? " is-active" : ""}`}
          onClick={onActivateSiblings}
          disabled={siblings.length === 0}
          aria-disabled={siblings.length === 0}
        >
          {actionLabel("Siblings", siblings.length)}
        </button>
        <button
          type="button"
          className={`tree-focus-action-chip${activeGroup === "children" ? " is-active" : ""}`}
          onClick={onActivateChildren}
          disabled={childrenList.length === 0}
          aria-disabled={childrenList.length === 0}
        >
          {actionLabel("Children", childrenList.length)}
        </button>
      </div>

      <div className="tree-focus-chip-list">
        {peopleChips.length === 0 ? <p className="tree-focus-empty">No people in this view.</p> : null}
        {peopleChips.map((person) => (
          <button
            key={`${activeGroup}-${person.personId}`}
            type="button"
            className={`tree-focus-person-chip${person.personId === selectedPerson.personId ? " is-selected" : ""}`}
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
