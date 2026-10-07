import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="button" {...props} />;
}

export function TextInput({ label, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <input className="text-input" id={id} type="text" {...props} />
  </div>;
}

export function StatusFeedback({ children, state }: { children: ReactNode; state: string }) {
  return <p className="status" role="status" aria-live="polite" aria-atomic="true" data-state={state}>{children}</p>;
}

export function List({ label, items }: { label: string; items: readonly { key: string; content: ReactNode }[] }) {
  return <ul className="field" aria-label={label}>
    {items.map((item) => <li key={item.key}>{item.content}</li>)}
  </ul>;
}
