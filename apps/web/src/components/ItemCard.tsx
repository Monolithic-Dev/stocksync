import type { DisplayItem } from "../state/ShopContext";
import { AttributionBadge } from "./AttributionBadge";
import { EditableField } from "./EditableField";

export interface ItemCardProps {
  item: DisplayItem;
  onSell: (itemId: string) => void;
  onRestock: (itemId: string) => void;
  onFieldUpdate: (itemId: string, field: string, value: unknown) => void;
}

export function ItemCard({ item, onSell, onRestock, onFieldUpdate }: ItemCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid={`item-card-${item.item_id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{item.name ?? item.item_id}</h3>
        <div className="flex flex-wrap justify-end gap-1">
          {item.stock_anomaly && (
            <span
              data-testid="stock-anomaly-badge"
              className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
              title="Stock went negative — this likely indicates a real discrepancy worth investigating, not a display bug"
            >
              Stock anomaly
            </span>
          )}
          {item.conflict_status === "needs_review" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Needs review
            </span>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Stock</dt>
        <dd
          data-testid="stock-value"
          className={`text-right font-medium ${
            item.stock_anomaly ? "text-rose-700" : item.optimistic ? "text-slate-400 italic" : "text-slate-900"
          }`}
        >
          {item.stock}
          {item.optimistic && <span className="ml-1 text-xs">(pending)</span>}
        </dd>

        {item.price !== undefined && (
          <>
            <dt className="text-slate-500">Price</dt>
            <dd className="flex items-center justify-end gap-1 text-right font-medium text-slate-900">
              ₹
              <EditableField
                value={item.price}
                testId="price-value"
                onCommit={(value) => onFieldUpdate(item.item_id, "price", Number(value))}
              />
              <AttributionBadge counterId={item.field_last_writer.price} />
            </dd>
          </>
        )}

        {item.shelf_location !== undefined && (
          <>
            <dt className="text-slate-500">Shelf</dt>
            <dd className="flex items-center justify-end gap-1 text-right font-medium text-slate-900">
              <EditableField
                value={item.shelf_location}
                testId="shelf-location-value"
                onCommit={(value) => onFieldUpdate(item.item_id, "shelf_location", value)}
              />
              <AttributionBadge counterId={item.field_last_writer.shelf_location} />
            </dd>
          </>
        )}
      </dl>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onSell(item.item_id)}
          className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Sell 1
        </button>
        <button
          type="button"
          onClick={() => onRestock(item.item_id)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Restock 1
        </button>
      </div>
    </div>
  );
}
