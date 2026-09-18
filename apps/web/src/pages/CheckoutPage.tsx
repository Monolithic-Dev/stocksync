import { useEffect, useState } from "react";
import type { Product } from "@stocksync/core";
import { postCheckout, productsApi, type CheckoutLineItem, type CheckoutResponse } from "../api/client";
import { CartDrawer } from "../components/CartDrawer";

export interface CheckoutPageProps {
  shopId: string;
  counterId: string;
}

/**
 * Multi-item cart + checkout (19b) — completing a checkout submits a
 * batch of `sale` transactions through the exact same, unmodified
 * POST /transactions pipeline every other write in the system uses
 * (checkout.ts, server-side); this page has no idea that's happening,
 * it just calls POST /checkout like any other API call.
 */
export function CheckoutPage({ shopId, counterId }: CheckoutPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [lineItems, setLineItems] = useState<CheckoutLineItem[]>([]);
  const [receipt, setReceipt] = useState<CheckoutResponse | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    productsApi
      .list(shopId)
      .then(setProducts)
      .catch(() => setError(true));
  }, [shopId]);

  function addToCart(product: Product): void {
    setLineItems((current) => {
      const existing = current.find((item) => item.product_id === product.product_id);
      if (existing) {
        return current.map((item) =>
          item.product_id === product.product_id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...current, { product_id: product.product_id, quantity: 1, unit_price: product.base_price ?? 0 }];
    });
  }

  function removeFromCart(productId: string): void {
    setLineItems((current) => current.filter((item) => item.product_id !== productId));
  }

  async function handleCheckout(): Promise<void> {
    if (lineItems.length === 0) return;
    try {
      const result = await postCheckout(shopId, counterId, lineItems);
      setReceipt(result);
      setLineItems([]);
      setError(false);
    } catch {
      setError(true);
    }
  }

  function productName(productId: string): string {
    return products.find((product) => product.product_id === productId)?.name ?? productId;
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-bold text-slate-900">Checkout</h1>

      {error && <p className="mb-4 text-sm text-rose-600">Something went wrong. Check the connection and try again.</p>}

      {receipt && (
        <p className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="checkout-receipt">
          Order {receipt.order_id} completed — total ₹{receipt.total_amount}.
        </p>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((product) => (
          <button
            key={product.product_id}
            type="button"
            onClick={() => addToCart(product)}
            data-testid={`cart-add-${product.product_id}`}
            className="rounded-lg border border-slate-200 bg-white p-3 text-left text-sm hover:bg-slate-50"
          >
            <div className="font-medium text-slate-900">{product.name}</div>
            <div className="text-slate-500">₹{product.base_price ?? 0}</div>
          </button>
        ))}
        {products.length === 0 && <p className="text-sm text-slate-400">No products in the catalog yet.</p>}
      </div>

      <CartDrawer lineItems={lineItems} productName={productName} onRemove={removeFromCart} />

      <button
        type="button"
        onClick={() => void handleCheckout()}
        disabled={lineItems.length === 0}
        className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Complete checkout
      </button>
    </div>
  );
}
