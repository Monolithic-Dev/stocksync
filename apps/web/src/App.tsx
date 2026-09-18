import { ShopProvider } from "./state/ShopContext";
import { CounterPage } from "./pages/CounterPage";
import { ProductsPage } from "./pages/ProductsPage";
import { CheckoutPage } from "./pages/CheckoutPage";

function useQueryParam(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

const NAV_LINKS = [
  { page: "counter", label: "Counter" },
  { page: "products", label: "Products" },
  { page: "checkout", label: "Checkout" },
] as const;

/**
 * Query-param page switch (?page=products|checkout, default counter) —
 * deliberately not a routing library: three flat pages, no nested
 * routes, no history-stack needs, and CounterPage/the demo already
 * relies on plain query params (?shop_id=&counter_id=) for identity, so
 * this stays consistent with that rather than introducing a second
 * navigation mechanism (19b).
 */
export function App() {
  const page = useQueryParam("page", "counter");
  const shopId = useQueryParam("shop_id", "demo-shop");
  const counterId = useQueryParam("counter_id", "counter_a");

  return (
    <ShopProvider>
      <nav className="mx-auto flex max-w-3xl gap-4 px-4 pt-4 text-sm sm:px-6">
        {NAV_LINKS.map((link) => (
          <a
            key={link.page}
            href={`?page=${link.page}&shop_id=${shopId}&counter_id=${counterId}`}
            className={page === link.page ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-700"}
          >
            {link.label}
          </a>
        ))}
      </nav>
      {page === "products" && <ProductsPage shopId={shopId} />}
      {page === "checkout" && <CheckoutPage shopId={shopId} counterId={counterId} />}
      {page !== "products" && page !== "checkout" && <CounterPage />}
    </ShopProvider>
  );
}
