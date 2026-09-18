import type { CheckoutLineItem } from "../api/client";

export interface CartDrawerProps {
  lineItems: CheckoutLineItem[];
  productName: (productId: string) => string;
  onRemove: (productId: string) => void;
}

/** Read-only cart summary shown alongside the item picker on CheckoutPage (19b). */
export function CartDrawer({ lineItems, productName, onRemove }: CartDrawerProps) {
  const total = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  if (lineItems.length === 0) {
    return <p className="text-sm text-slate-400">Cart is empty — add items from the list.</p>;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <ul className="space-y-1 text-sm">
        {lineItems.map((item) => (
          <li key={item.product_id} className="flex items-center justify-between" data-testid={`cart-line-${item.product_id}`}>
            <span>
              {productName(item.product_id)} × {item.quantity}
            </span>
            <span className="flex items-center gap-2">
              ₹{item.quantity * item.unit_price}
              <button type="button" onClick={() => onRemove(item.product_id)} className="text-xs text-rose-600 hover:underline">
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900" data-testid="cart-total">
        <span>Total</span>
        <span>₹{total}</span>
      </div>
    </div>
  );
}
