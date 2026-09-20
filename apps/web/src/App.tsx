import { useState } from "react";
import { LayoutGrid, Package, ShoppingCart, LayoutDashboard, Users, Boxes, LogOut } from "lucide-react";
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
  { page: "counter", label: "Counter", icon: LayoutGrid, roles: ["owner", "manager", "counter_staff"] },
  { page: "products", label: "Products", icon: Package, roles: ["owner", "manager", "counter_staff"] },
  { page: "checkout", label: "Checkout", icon: ShoppingCart, roles: ["owner", "manager", "counter_staff"] },
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager"] },
  { page: "staff", label: "Staff", icon: Users, roles: ["owner"] },
] as const;

interface AuthedAppProps {
  shopId: string;
  role: "owner" | "manager" | "counter_staff";
  user: AuthUser;
  onSignOut: () => void;
}

/**
 * Everything past "we know which shop and which role" — still needs to
 * know which physical counter this browser session is (CounterPicker),
 * then the same ?page= nav phase-19b already established. Query-param
 * page switch stays deliberately not a routing library — see the
 * original comment this replaced in git history for why.
 */
function AuthedApp({ shopId, role, user, onSignOut }: AuthedAppProps) {
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
      <div>
        <TopBar user={user} onSignOut={onSignOut} links={[]} activePage="" counterId="" />
        <div className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
          <CounterPicker onEnter={handleEnterCounter} />
        </div>
      </div>
    );
  }

  const visibleLinks = NAV_LINKS.filter((link) => (link.roles as readonly string[]).includes(role));

  return (
    <ShopProvider>
      <TopBar user={user} onSignOut={onSignOut} links={visibleLinks} activePage={page} counterId={counterId} />
      {page === "products" && <ProductsPage shopId={shopId} />}
      {page === "checkout" && <CheckoutPage shopId={shopId} counterId={counterId} />}
      {page === "dashboard" && (role === "owner" || role === "manager") && <DashboardPage shopId={shopId} />}
      {page === "staff" && role === "owner" && <StaffPage />}
      {!["products", "checkout", "dashboard", "staff"].includes(page) && <CounterPage />}
    </ShopProvider>
  );
}

interface NavLink {
  page: string;
  label: string;
  icon: typeof LayoutGrid;
  roles: readonly string[];
}

interface TopBarProps {
  user: AuthUser;
  onSignOut: () => void;
  links: readonly NavLink[];
  activePage: string;
  counterId: string;
}

function TopBar({ user, onSignOut, links, activePage, counterId }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-indigo-700 text-white">
            <Boxes className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <span className="hidden font-display text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:inline">
            StockSync
          </span>
        </div>

        <nav className="flex flex-1 items-center justify-center gap-1 overflow-x-auto text-sm">
          {links.map((link) => {
            const isActive = activePage === link.page;
            return (
              <a
                key={link.page}
                href={`?page=${link.page}&counter_id=${counterId}`}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <link.icon className="h-3.5 w-3.5" strokeWidth={2} />
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <span className="hidden max-w-[10rem] truncate text-xs text-slate-500 dark:text-slate-400 md:inline">{user.email}</span>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <LogOut className="h-4 w-4" strokeWidth={2} />
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
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

  return <AuthedApp shopId={user.shopId} role={user.role ?? "counter_staff"} user={user} onSignOut={signOut} />;
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
