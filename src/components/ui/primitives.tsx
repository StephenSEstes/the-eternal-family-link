import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  subtitle?: string;
};

export function Card({ title, subtitle, className = "", children, ...props }: CardProps) {
  return (
    <section className={`ui-card ${className}`.trim()} {...props}>
      {title ? <h3 className="ui-section-title">{title}</h3> : null}
      {subtitle ? <p className="ui-section-subtitle">{subtitle}</p> : null}
      {children}
    </section>
  );
}

type LabelProps = HTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
};

export function FieldLabel({ children, className = "", ...props }: LabelProps) {
  return (
    <label className={`ui-label ${className}`.trim()} {...props}>
      {children}
    </label>
  );
}

export function PrimaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button button-primary ${className}`.trim()} {...props} />;
}

export function SecondaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button secondary ${className}`.trim()} {...props} />;
}

export type StatusTone = "pending" | "success" | "error" | "info";

type AsyncActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel?: ReactNode;
  tone?: "primary" | "secondary" | "danger";
};

function buttonToneClassName(tone: AsyncActionButtonProps["tone"]) {
  if (tone === "secondary") {
    return "button secondary";
  }
  if (tone === "danger") {
    return "button button-danger";
  }
  return "button button-primary";
}

export function AsyncActionButton({
  className = "",
  pending = false,
  pendingLabel,
  tone = "primary",
  disabled,
  children,
  ...props
}: AsyncActionButtonProps) {
  return (
    <button
      className={`${buttonToneClassName(tone)} ${pending ? "is-pending" : ""} ${className}`.trim()}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      <span className="button-content">
        {pending ? <span className="button-spinner" aria-hidden="true" /> : null}
        <span>{pending ? pendingLabel ?? children : children}</span>
      </span>
    </button>
  );
}

type ModalStatusBannerProps = HTMLAttributes<HTMLParagraphElement> & {
  tone?: StatusTone;
  children: ReactNode;
};

export function ModalStatusBanner({ tone = "info", className = "", children, ...props }: ModalStatusBannerProps) {
  const role = tone === "error" ? "alert" : "status";
  const ariaLive = tone === "error" ? "assertive" : "polite";
  return (
    <p
      className={`modal-status-banner is-${tone} ${className}`.trim()}
      role={role}
      aria-live={ariaLive}
      {...props}
    >
      {children}
    </p>
  );
}

type ModalActionBarProps = HTMLAttributes<HTMLDivElement> & {
  status?: ReactNode;
  actions?: ReactNode;
};

export function ModalActionBar({ status = null, actions = null, className = "", children, ...props }: ModalActionBarProps) {
  const resolvedActions = actions ?? children;
  return (
    <div className={`modal-action-bar ${className}`.trim()} {...props}>
      <div className="modal-action-bar-status">{status}</div>
      <div className="modal-action-bar-actions">{resolvedActions}</div>
    </div>
  );
}

type ModalCloseButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
};

export function ModalCloseButton({ className = "", label = "Close", ...props }: ModalCloseButtonProps) {
  return (
    <button type="button" className={`modal-close-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d="M5 5L15 15M15 5L5 15"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
    </button>
  );
}

export function inferStatusTone(status: string): StatusTone {
  const value = status.trim().toLowerCase();
  if (!value) {
    return "info";
  }
  if (
    value.startsWith("failed") ||
    value.startsWith("cannot") ||
    value.startsWith("error") ||
    value.includes("required") ||
    value.includes("not found") ||
    value.includes("invalid") ||
    value.includes("does not match") ||
    value.includes("could not")
  ) {
    return "error";
  }
  if (
    value.startsWith("saving") ||
    value.startsWith("creating") ||
    value.startsWith("updating") ||
    value.startsWith("sending") ||
    value.startsWith("deleting") ||
    value.startsWith("loading") ||
    value.startsWith("activating") ||
    value.startsWith("signing in") ||
    value.startsWith("running") ||
    value.startsWith("repairing") ||
    value.startsWith("scanning") ||
    value.startsWith("importing") ||
    value.startsWith("merging")
  ) {
    return "pending";
  }
  if (
    value.startsWith("saved") ||
    value.startsWith("user updated") ||
    value.startsWith("password updated") ||
    value.startsWith("created") ||
    value.startsWith("invite created") ||
    value.startsWith("invite sent") ||
    value.startsWith("household saved") ||
    value.startsWith("local user saved") ||
    value.startsWith("policy saved")
  ) {
    return "success";
  }
  return "info";
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />;
}

export function SelectInput({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${className}`.trim()} {...props} />;
}

export function TextAreaInput({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`.trim()} {...props} />;
}
