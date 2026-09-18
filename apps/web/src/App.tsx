import { useState } from "react";
import { ShopProvider } from "./state/ShopContext";
import { CounterPage } from "./pages/CounterPage";
import { HeroPage } from "./pages/HeroPage";
import { ProductsPage } from "./pages/ProductsPage";
import { CheckoutPage } from "./pages/CheckoutPage";

interface CounterEntry {
  shopId: string;
  counterId: string;
}

/** A direct/shareable link (README's ?shop_id=&counter_id= pattern) already knows which counter it wants — skip the landing page and go straight there. */
function readEntryFromUrl(): CounterEntry | null {
  const params = new URLSearchParams(window.location.search);
  const shopId = params.get("shop_id");
  const counterId = params.get("counter_id");
  return shopId && counterId ? { shopId, counterId } : null;
}

const NAV_LINKS = [
  { page: "counter", label: "Counter" },
  { page: "products", label: "Products" },
  { page: "checkout", label: "Checkout" },
] as const;

/**
 * Landing page picks a counter; once entered, a query-param page switch
 * (?page=products|checkout, default counter) — deliberately not a routing
 * library: three flat pages, and the app already relies on plain query
 * params (?shop_id=&counter_id=) for identity (19b).
 */
export function App() {
  const [entry, setEntry] = useState<CounterEntry | null>(readEntryFromUrl);
  const page = new URLSearchParams(window.location.search).get("page") ?? "counter";

  function handleEnter(shopId: string, counterId: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("shop_id", shopId);
    url.searchParams.set("counter_id", counterId);
    window.history.pushState({}, "", url);
    setEntry({ shopId, counterId });
  }

  if (!entry) {
    return (
      <ShopProvider>
        <HeroPage onEnter={handleEnter} />
      </ShopProvider>
    );
  }

  return (
    <ShopProvider>
      <nav className="mx-auto flex max-w-3xl gap-4 px-4 pt-4 text-sm sm:px-6">
        {NAV_LINKS.map((link) => (
          <a
            key={link.page}
            href={`?page=${link.page}&shop_id=${entry.shopId}&counter_id=${entry.counterId}`}
            className={page === link.page ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-700"}
          >
            {link.label}
          </a>
        ))}
      </nav>
      {page === "products" && <ProductsPage shopId={entry.shopId} />}
      {page === "checkout" && <CheckoutPage shopId={entry.shopId} counterId={entry.counterId} />}
      {page !== "products" && page !== "checkout" && <CounterPage />}
    </ShopProvider>
  );
}
