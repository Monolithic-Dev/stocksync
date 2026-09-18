import { useState } from "react";
import { ShopProvider } from "./state/ShopContext";
import { CounterPage } from "./pages/CounterPage";
import { HeroPage } from "./pages/HeroPage";

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

export function App() {
  const [entry, setEntry] = useState<CounterEntry | null>(readEntryFromUrl);

  function handleEnter(shopId: string, counterId: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("shop_id", shopId);
    url.searchParams.set("counter_id", counterId);
    window.history.pushState({}, "", url);
    setEntry({ shopId, counterId });
  }

  return (
    <ShopProvider>
      {entry ? <CounterPage /> : <HeroPage onEnter={handleEnter} />}
    </ShopProvider>
  );
}
