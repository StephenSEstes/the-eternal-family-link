"use client";

type PersonNodeCardProps = {
  personId: string;
  displayName: string;
  secondaryText?: string;
  avatarUrl: string;
  onOpenPerson: (personId: string) => void;
};

export function PersonNodeCard({
  personId,
  displayName,
  secondaryText,
  avatarUrl,
  onOpenPerson,
}: PersonNodeCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="tree-person-card"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpenPerson(personId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPerson(personId);
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
