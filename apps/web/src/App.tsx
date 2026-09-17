import { ShopProvider } from "./state/ShopContext";
import { CounterPage } from "./pages/CounterPage";

export function App() {
  return (
    <ShopProvider>
      <CounterPage />
    </ShopProvider>
  );
}
