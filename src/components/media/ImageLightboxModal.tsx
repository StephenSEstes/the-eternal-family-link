"use client";

import { useEffect, useMemo, useState, type WheelEvent } from "react";
import { ModalCloseButton } from "@/components/ui/primitives";

type ImageLightboxModalProps = {
  open: boolean;
  imageSrc: string;
  alt: string;
  caption?: string;
  indexLabel?: string;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function ImageLightboxModal({
  open,
  imageSrc,
  alt,
  caption,
  indexLabel,
  canPrev = false,
  canNext = false,
  onPrev,
  onNext,
  onClose,
}: ImageLightboxModalProps) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open) return;
    setZoom(1);
  }, [open, imageSrc]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && canPrev && onPrev) {
        event.preventDefault();
        onPrev();
        return;
      }
      if (event.key === "ArrowRight" && canNext && onNext) {
        event.preventDefault();
        onNext();
        return;
      }
      if ((event.key === "+" || event.key === "=") && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setZoom((current) => clampZoom(current + ZOOM_STEP));
        return;
      }
      if ((event.key === "-" || event.key === "_") && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setZoom((current) => clampZoom(current - ZOOM_STEP));
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canNext, canPrev, onClose, onNext, onPrev, open]);

  const zoomPercent = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

  if (!open) return null;

  const onWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((current) => clampZoom(current + delta));
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 170,
        background: "rgba(10,16,30,0.88)",
        padding: "0.9rem",
        display: "grid",
        placeItems: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: "relative",
          width: "min(1700px, 100%)",
          height: "min(96vh, 980px)",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: "0.55rem",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.45rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
              aria-label="Reset zoom"
            >
              Reset
            </button>
            <span className="status-chip status-chip--neutral">{zoomPercent}</span>
            {indexLabel ? <span className="status-chip status-chip--neutral">{indexLabel}</span> : null}
          </div>
          <ModalCloseButton className="modal-close-button--floating" onClick={onClose} />
        </div>

        <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
          {canPrev ? (
            <button
              type="button"
              className="button secondary tap-button"
              onClick={onPrev}
              aria-label="Previous image"
              style={{ position: "absolute", left: "0.5rem", top: "50%", transform: "translateY(-50%)", zIndex: 2 }}
            >
              {"<"}
            </button>
          ) : null}

          <div
            style={{
              width: "min(100%, 1600px)",
              height: "100%",
              maxHeight: "84vh",
              overflow: "auto",
              borderRadius: "14px",
              background: "rgba(4,10,20,0.82)",
              border: "1px solid rgba(148, 163, 184, 0.45)",
              padding: "0.7rem",
              display: "grid",
              placeItems: "center",
            }}
            onWheel={onWheelZoom}
          >
            <img
              src={imageSrc}
              alt={alt}
              draggable={false}
              style={{
                width: "auto",
                height: "auto",
                maxWidth: `${95 * zoom}vw`,
                maxHeight: `${85 * zoom}vh`,
                borderRadius: "12px",
                border: "1px solid rgba(148, 163, 184, 0.6)",
                background: "#fff",
                display: "block",
              }}
            />
          </div>

          {canNext ? (
            <button
              type="button"
              className="button secondary tap-button"
              onClick={onNext}
              aria-label="Next image"
              style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", zIndex: 2 }}
            >
              {">"}
            </button>
          ) : null}
        </div>

        <div style={{ minHeight: "1.5rem", display: "grid", placeItems: "center" }}>
          {caption ? (
            <p style={{ margin: 0, color: "#e2e8f0", fontSize: "0.9rem", textAlign: "center" }}>{caption}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
