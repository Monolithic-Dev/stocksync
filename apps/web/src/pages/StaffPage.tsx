import { useState, type FormEvent } from "react";
import { postStaffInvite } from "../api/client";

/**
 * Owner-only (App.tsx only renders this for role === "owner"; the server
 * enforces the same rule independently via authContext.ts's
 * canInviteStaff, so this page being reachable is never the actual
 * security boundary). Invites a manager or counter staff member — they
 * receive a temporary password by email and set their own on first
 * sign-in (AuthPanel's "new_password_required" step).
 */
export function StaffPage() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "counter_staff">("counter_staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invited, setInvited] = useState<{ email: string; role: string }[]>([]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await postStaffInvite(email, role);
      setInvited((prev) => [...prev, { email: result.email, role: result.role }]);
      setEmail("");
    } catch {
      setError("Couldn't invite that person — check the email address and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-bold text-slate-900">Invite staff</h1>
      <p className="mt-1 text-sm text-slate-600">
        Managers can edit the catalog and run checkout. Counter staff can browse the catalog and run checkout, but
        can't add, edit, or delete products, categories, or suppliers.
      </p>

      <form className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
        <div className="flex-1">
          <label htmlFor="staff-email" className="mb-1 block text-xs font-medium text-slate-500">
            Email
          </label>
          <input
            id="staff-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="staff@shop.com"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="staff-role" className="mb-1 block text-xs font-medium text-slate-500">
            Role
          </label>
          <select
            id="staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value as "manager" | "counter_staff")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="counter_staff">Counter staff</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          Send invite
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {invited.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {invited.map((entry) => (
            <li key={entry.email} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-800">{entry.email}</span>
              <span className="text-xs text-slate-500">{entry.role}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
