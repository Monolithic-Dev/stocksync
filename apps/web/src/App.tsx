import { useState } from "react";
import { AuthProvider, useAuth, type AuthUser } from "./state/AuthContext";
import { ShopProvider } from "./state/ShopContext";
import { ThemeProvider } from "./state/ThemeContext";
import { ToastProvider } from "./state/ToastContext";
import { CounterPage } from "./pages/CounterPage";
import { HeroPage } from "./pages/HeroPage";
import { ProductsPage } from "./pages/ProductsPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { StaffPage } from "./pages/StaffPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CounterPicker } from "./components/CounterPicker";
import { ThemeToggle } from "./components/ThemeToggle";
import { ToastContainer } from "./components/ToastContainer";

function useQueryParam(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function readCounterIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("counter_id");
}

const NAV_LINKS = [
  { page: "counter", label: "Counter", roles: ["owner", "manager", "counter_staff"] },
  { page: "products", label: "Products", roles: ["owner", "manager", "counter_staff"] },
  { page: "checkout", label: "Checkout", roles: ["owner", "manager", "counter_staff"] },
  { page: "dashboard", label: "Dashboard", roles: ["owner", "manager"] },
  { page: "staff", label: "Staff", roles: ["owner"] },
] as const;

interface AuthedAppProps {
  shopId: string;
  role: "owner" | "manager" | "counter_staff";
}

/**
 * Everything past "we know which shop and which role" — still needs to
 * know which physical counter this browser session is (CounterPicker),
 * then the same ?page= nav phase-19b already established. Query-param
 * page switch stays deliberately not a routing library — see the
 * original comment this replaced in git history for why.
 */
function AuthedApp({ shopId, role }: AuthedAppProps) {
  const [counterId, setCounterId] = useState<string | null>(readCounterIdFromUrl);
  const page = useQueryParam("page", "counter");

  function handleEnterCounter(id: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("counter_id", id);
    window.history.pushState({}, "", url);
    setCounterId(id);
  }

  if (!counterId) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <CounterPicker onEnter={handleEnterCounter} />
      </div>
    );
  }

  const visibleLinks = NAV_LINKS.filter((link) => (link.roles as readonly string[]).includes(role));

  return (
    <ShopProvider>
      <nav className="mx-auto flex max-w-3xl gap-4 px-4 pt-4 text-sm sm:px-6">
        {visibleLinks.map((link) => (
          <a
            key={link.page}
            href={`?page=${link.page}&counter_id=${counterId}`}
            className={
              page === link.page
                ? "font-semibold text-slate-900 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }
          >
            {link.label}
          </a>
        ))}
      </nav>
      {page === "products" && <ProductsPage shopId={shopId} />}
      {page === "checkout" && <CheckoutPage shopId={shopId} counterId={counterId} />}
      {page === "dashboard" && (role === "owner" || role === "manager") && <DashboardPage shopId={shopId} />}
      {page === "staff" && role === "owner" && <StaffPage />}
      {!["products", "checkout", "dashboard", "staff"].includes(page) && <CounterPage />}
    </ShopProvider>
  );
}

function TopBar({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  return (
    <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-4 pt-3 text-xs text-slate-400 sm:px-6">
      <span>{user.email}</span>
      <button type="button" onClick={onSignOut} className="underline decoration-dotted hover:text-slate-600 dark:hover:text-slate-200">
        Sign out
      </button>
      <ThemeToggle />
    </div>
  );
}

function AppShell() {
  const { status, user, signOut } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>
    );
  }

  if (status === "signed_out" || !user?.shopId) {
    return <HeroPage />;
  }

  return (
    <div>
      <TopBar user={user} onSignOut={signOut} />
      <AuthedApp shopId={user.shopId} role={user.role ?? "counter_staff"} />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
        <ToastContainer />
      </ToastProvider>
    </ThemeProvider>
  );
}
