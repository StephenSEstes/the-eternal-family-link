"use client";

type PersonNodeCardProps = {
  personId: string;
  displayName: string;
  secondaryText?: string;
  avatarUrl: string;
  selected: boolean;
  dimmed: boolean;
  onSelect: (personId: string) => void;
  onEditPerson?: (personId: string) => void;
  onEditHousehold?: (personId: string) => void;
  hasHousehold?: boolean;
};

export function PersonNodeCard({
  personId,
  displayName,
  secondaryText,
  avatarUrl,
  selected,
  dimmed,
  onSelect,
  onEditPerson,
  onEditHousehold,
  hasHousehold = false,
}: PersonNodeCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`tree-person-card ${selected ? "is-selected" : ""} ${dimmed ? "is-dimmed" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(personId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(personId);
        }
      }}
      aria-pressed={selected}
      aria-label={`Focus on ${displayName}`}
    >
      <img className="tree-person-avatar" src={avatarUrl} alt={displayName} />
      <span className="tree-person-meta">
        <span className="tree-person-name">{displayName}</span>
        {secondaryText ? <span className="tree-person-secondary">{secondaryText}</span> : null}
      </span>
      <span className="tree-person-actions" aria-hidden="true">
        <button
          type="button"
          className="tree-person-dot-button"
          title="Edit person"
          aria-label={`Edit person ${displayName}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onEditPerson?.(personId);
          }}
        >
          <span className="tree-person-dot" />
        </button>
        <button
          type="button"
          className="tree-person-dot-button"
          title={hasHousehold ? "Edit household" : "No household linked"}
          aria-label={hasHousehold ? `Edit household for ${displayName}` : `No household for ${displayName}`}
          disabled={!hasHousehold}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (hasHousehold) {
              onEditHousehold?.(personId);
            }
          }}
        >
          <span className="tree-person-dot" />
        </button>
      </span>
    </div>
  );
}
