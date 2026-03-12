"use client";

type PersonNodeCardProps = {
  personId: string;
  displayName: string;
  secondaryText?: string;
  avatarUrl: string;
  isSelected?: boolean;
  isDimmed?: boolean;
  onSelectPerson: (personId: string) => void;
  onOpenPerson: (personId: string) => void;
};

export function PersonNodeCard({
  personId,
  displayName,
  secondaryText,
  avatarUrl,
  isSelected = false,
  isDimmed = false,
  onSelectPerson,
  onOpenPerson,
}: PersonNodeCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`tree-person-card${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (isSelected) {
          onOpenPerson(personId);
          return;
        }
        onSelectPerson(personId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (isSelected) {
            onOpenPerson(personId);
            return;
          }
          onSelectPerson(personId);
        }
        if (event.key === " ") {
          event.preventDefault();
          onSelectPerson(personId);
        }
      }}
      aria-label={`Open ${displayName}`}
    >
      <img className="tree-person-avatar" src={avatarUrl} alt={displayName} />
      <span className="tree-person-meta">
        <span className="tree-person-name">{displayName}</span>
        {secondaryText ? <span className="tree-person-secondary">{secondaryText}</span> : null}
      </span>
    </div>
  );
}
