import { useState } from "react";

export interface EditableFieldProps {
  value: string | number;
  onCommit: (value: string) => void;
  testId?: string;
}

/** Click-to-edit inline value — the UI's only way to trigger a field_update transaction (price, shelf_location). */
export function EditableField({ value, onCommit, testId }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function commit(): void {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== "" && trimmed !== String(value)) {
      onCommit(trimmed);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className="underline decoration-dotted decoration-slate-400 underline-offset-2 hover:decoration-slate-700 dark:decoration-slate-600 dark:hover:decoration-slate-300"
        title="Click to edit"
      >
        {value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      data-testid={testId}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setEditing(false);
      }}
      className="w-20 rounded border border-slate-300 bg-white px-1 text-right text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
    />
  );
}
