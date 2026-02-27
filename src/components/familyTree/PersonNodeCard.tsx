"use client";

type PersonNodeCardProps = {
  personId: string;
  displayName: string;
  secondaryText?: string;
  avatarUrl: string;
  selected: boolean;
  dimmed: boolean;
  onSelect: (personId: string) => void;
};

export function PersonNodeCard({
  personId,
  displayName,
  secondaryText,
  avatarUrl,
  selected,
  dimmed,
  onSelect,
}: PersonNodeCardProps) {
  return (
    <button
      type="button"
      className={`tree-person-card ${selected ? "is-selected" : ""} ${dimmed ? "is-dimmed" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(personId);
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
        <span className="tree-person-dot" />
        <span className="tree-person-dot" />
      </span>
    </button>
  );
}
