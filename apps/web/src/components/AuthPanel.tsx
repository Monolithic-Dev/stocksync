import { useState, type FormEvent } from "react";
import { useAuth } from "../state/AuthContext";
import { ArrowRightIcon } from "./icons";

type Mode = "login" | "signup" | "confirm" | "new_password";

const INPUT_CLASS = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const SUBMIT_CLASS =
  "flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50";

/**
 * The app's real front door for identity — replaces the old shop_id/
 * counter_id picker at HeroPage's #try-it anchor now that shop identity
 * comes from a real account (Cognito), not a free-text ID anyone could
 * type. Which physical counter this session is (CounterPicker, shown
 * post-login in App.tsx) is now a separate, lighter-weight step.
 */
export function AuthPanel() {
  const { signUp, confirmSignUp, resendConfirmationCode, signIn, completeNewPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shopName, setShopName] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");

  async function handleLogin(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await signIn(email, password);
      if (result.newPasswordRequired && result.session) {
        setSession(result.session);
        setMode("new_password");
      }
    } catch {
      setError("Couldn't sign in — check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signUp({ email, password, shopName });
      setMode("confirm");
    } catch {
      setError("Couldn't create that account — the email may already be in use, or the password is too weak (8+ characters, upper + lower + a digit).");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await confirmSignUp(email, code);
      setMode("login");
      setInfo("Email confirmed — sign in below.");
      setCode("");
    } catch {
      setError("That code didn't work — check your inbox and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleNewPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await completeNewPassword(email, newPassword, session);
    } catch {
      setError("Couldn't set that password — try a stronger one (8+ characters, upper + lower + a digit).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="try-it" className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      {mode === "login" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-600">Enter your shop's account to get to your counter.</p>
          {info && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{info}</p>}
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleLogin}>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@shop.com"
              aria-label="Email"
              className={INPUT_CLASS}
            />
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              aria-label="Password"
              className={INPUT_CLASS}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              Sign in <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setError("");
            }}
            className="mt-4 text-sm text-slate-500 underline decoration-dotted hover:text-slate-700"
          >
            New shop? Create an account instead
          </button>
        </>
      )}

      {mode === "signup" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">Set up your shop</h2>
          <p className="mt-1 text-sm text-slate-600">You'll be the owner — invite your staff once you're in.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSignup}>
            <input
              value={shopName}
              required
              onChange={(event) => setShopName(event.target.value)}
              placeholder="Shop name"
              aria-label="Shop name"
              className={INPUT_CLASS}
            />
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@shop.com"
              aria-label="Email"
              className={INPUT_CLASS}
            />
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password (8+ characters)"
              aria-label="Password"
              className={INPUT_CLASS}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              Create account <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            className="mt-4 text-sm text-slate-500 underline decoration-dotted hover:text-slate-700"
          >
            Already have an account? Sign in
          </button>
        </>
      )}

      {mode === "confirm" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">Check your email</h2>
          <p className="mt-1 text-sm text-slate-600">Enter the confirmation code we sent to {email}.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleConfirm}>
            <input
              value={code}
              required
              onChange={(event) => setCode(event.target.value)}
              placeholder="Confirmation code"
              aria-label="Confirmation code"
              className={INPUT_CLASS}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              Confirm <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
          <button
            type="button"
            onClick={() => void resendConfirmationCode(email)}
            className="mt-4 text-sm text-slate-500 underline decoration-dotted hover:text-slate-700"
          >
            Resend code
          </button>
        </>
      )}

      {mode === "new_password" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">Choose a password</h2>
          <p className="mt-1 text-sm text-slate-600">First sign-in on an invited account — set your own password to continue.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleNewPassword}>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="New password (8+ characters)"
              aria-label="New password"
              className={INPUT_CLASS}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              Set password and continue <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
