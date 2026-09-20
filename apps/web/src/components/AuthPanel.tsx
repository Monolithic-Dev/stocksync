import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../state/AuthContext";
import {
  ArrowRight,
  Mail,
  Lock,
  Store,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

type Mode = "login" | "signup" | "confirm" | "new_password";

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20";
const SUBMIT_CLASS =
  "group flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-600/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-600/30 disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none";
const LINK_CLASS = "mt-5 block text-center text-sm text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";

interface FieldProps {
  icon: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

function Field({ icon, trailing, children }: FieldProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">{icon}</span>
      {children}
      {trailing && <span className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</span>}
    </div>
  );
}

function PasswordVisibilityToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      tabIndex={-1}
      aria-label={visible ? "Hide password" : "Show password"}
      className="pointer-events-auto text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);

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
    <div
      id="try-it"
      className="mx-auto max-w-md animate-fade-in-up rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-none sm:p-8"
    >
      {mode === "login" && (
        <div className="animate-fade-in">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Sign in</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Enter your shop's account to get to your counter.</p>
          {info && (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {info}
            </p>
          )}
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleLogin}>
            <Field icon={<Mail className="h-4 w-4" />}>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@shop.com"
                aria-label="Email"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              icon={<Lock className="h-4 w-4" />}
              trailing={<PasswordVisibilityToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
            >
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                aria-label="Password"
                className={INPUT_CLASS}
              />
            </Field>
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setError("");
            }}
            className={LINK_CLASS}
          >
            New shop? Create an account instead
          </button>
        </div>
      )}

      {mode === "signup" && (
        <div className="animate-fade-in">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Set up your shop</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">You'll be the owner — invite your staff once you're in.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSignup}>
            <Field icon={<Store className="h-4 w-4" />}>
              <input
                value={shopName}
                required
                onChange={(event) => setShopName(event.target.value)}
                placeholder="Shop name"
                aria-label="Shop name"
                className={INPUT_CLASS}
              />
            </Field>
            <Field icon={<Mail className="h-4 w-4" />}>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@shop.com"
                aria-label="Email"
                className={INPUT_CLASS}
              />
            </Field>
            <Field
              icon={<Lock className="h-4 w-4" />}
              trailing={<PasswordVisibilityToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
            >
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password (8+ characters)"
                aria-label="Password"
                className={INPUT_CLASS}
              />
            </Field>
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            className={LINK_CLASS}
          >
            Already have an account? Sign in
          </button>
        </div>
      )}

      {mode === "confirm" && (
        <div className="animate-fade-in">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
            <Mail className="h-5 w-5" />
          </div>
          <h2 className="mt-3 font-display text-xl font-bold text-slate-900 dark:text-slate-100">Check your email</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Enter the confirmation code we sent to {email}.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleConfirm}>
            <Field icon={<KeyRound className="h-4 w-4" />}>
              <input
                value={code}
                required
                onChange={(event) => setCode(event.target.value)}
                placeholder="Confirmation code"
                aria-label="Confirmation code"
                className={INPUT_CLASS}
              />
            </Field>
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Confirm <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
          </form>
          <button type="button" onClick={() => void resendConfirmationCode(email)} className={LINK_CLASS}>
            Resend code
          </button>
        </div>
      )}

      {mode === "new_password" && (
        <div className="animate-fade-in">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Choose a password</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">First sign-in on an invited account — set your own password to continue.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleNewPassword}>
            <Field
              icon={<Lock className="h-4 w-4" />}
              trailing={<PasswordVisibilityToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
            >
              <input
                type={showPassword ? "text" : "password"}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="New password (8+ characters)"
                aria-label="New password"
                className={INPUT_CLASS}
              />
            </Field>
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className={SUBMIT_CLASS}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Set password and continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
