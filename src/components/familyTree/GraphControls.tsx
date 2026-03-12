"use client";

type GraphControlsProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onClearFocus?: () => void;
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function GraphControls({ onZoomIn, onZoomOut, onFit, onClearFocus }: GraphControlsProps) {
  return (
    <div className="tree-control-cluster">
      {onClearFocus ? (
        <button type="button" className="tree-control-btn" onClick={onClearFocus} aria-label="Clear focus mode">
          <ClearIcon />
        </button>
      ) : null}
      <button type="button" className="tree-control-btn" onClick={onZoomIn} aria-label="Zoom in">
        <PlusIcon />
      </button>
      <button type="button" className="tree-control-btn" onClick={onZoomOut} aria-label="Zoom out">
        <MinusIcon />
      </button>
      <button type="button" className="tree-control-btn" onClick={onFit} aria-label="Fit graph to view">
        <FitIcon />
      </button>
    </div>
  );
}
