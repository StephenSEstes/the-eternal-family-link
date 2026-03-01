import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

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

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />;
}

export function SelectInput({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${className}`.trim()} {...props} />;
}

export function TextAreaInput({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`.trim()} {...props} />;
}
