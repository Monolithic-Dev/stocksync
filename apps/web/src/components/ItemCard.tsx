import type { DisplayItem } from "../state/ShopContext";
import { AttributionBadge } from "./AttributionBadge";
import { EditableField } from "./EditableField";
import { AlertTriangleIcon, BoxIcon, CalendarIcon, MapPinIcon, MinusIcon, PlusIcon, TagIcon } from "./icons";

export interface ItemCardProps {
  item: DisplayItem;
  highlighted?: boolean;
  onSell: (itemId: string) => void;
  onRestock: (itemId: string) => void;
  onFieldUpdate: (itemId: string, field: string, value: unknown) => void;
}

export function ItemCard({ item, highlighted, onSell, onRestock, onFieldUpdate }: ItemCardProps) {
  return (
    <div
      className={`rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:bg-slate-900 dark:hover:shadow-none ${
        highlighted ? "border-indigo-400 ring-2 ring-indigo-400 dark:border-indigo-500 dark:ring-indigo-500" : "border-slate-200 dark:border-slate-800"
      }`}
      data-testid={`item-card-${item.item_id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{item.name ?? item.item_id}</h3>
        <div className="flex flex-wrap justify-end gap-1">
          {item.stock_anomaly && (
            <span
              data-testid="stock-anomaly-badge"
              className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-300"
              title="Stock went negative — this likely indicates a real discrepancy worth investigating, not a display bug"
            >
              <AlertTriangleIcon className="h-3 w-3" />
              Stock anomaly
            </span>
          )}
          {item.conflict_status === "needs_review" && (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangleIcon className="h-3 w-3" />
              Needs review
            </span>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <BoxIcon className="h-3.5 w-3.5" />
          Stock
        </dt>
        <dd
          data-testid="stock-value"
          className={`text-right font-medium transition-colors ${
            item.stock_anomaly
              ? "text-rose-700 dark:text-rose-400"
              : item.optimistic
                ? "text-slate-400 italic dark:text-slate-500"
                : "text-slate-900 dark:text-slate-100"
          }`}
        >
          {item.stock}
          {item.optimistic && <span className="ml-1 text-xs">(pending)</span>}
        </dd>

        {item.price !== undefined && (
          <>
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <TagIcon className="h-3.5 w-3.5" />
              Price
            </dt>
            <dd className="flex items-center justify-end gap-1 text-right font-medium text-slate-900 dark:text-slate-100">
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
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <MapPinIcon className="h-3.5 w-3.5" />
              Shelf
            </dt>
            <dd className="flex items-center justify-end gap-1 text-right font-medium text-slate-900 dark:text-slate-100">
              <EditableField
                value={item.shelf_location}
                testId="shelf-location-value"
                onCommit={(value) => onFieldUpdate(item.item_id, "shelf_location", value)}
              />
              <AttributionBadge counterId={item.field_last_writer.shelf_location} />
            </dd>
          </>
        )}

        {item.expiry_date !== undefined && (
          <>
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <CalendarIcon className="h-3.5 w-3.5" />
              Expires
            </dt>
            <dd className="flex items-center justify-end gap-1 text-right font-medium text-slate-900 dark:text-slate-100">
              <EditableField
                value={item.expiry_date}
                testId="expiry-date-value"
                onCommit={(value) => onFieldUpdate(item.item_id, "expiry_date", value)}
              />
              <AttributionBadge counterId={item.field_last_writer.expiry_date} />
            </dd>
          </>
        )}
      </dl>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onSell(item.item_id)}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 active:scale-95"
        >
          <MinusIcon className="h-3.5 w-3.5" />
          Sell 1
        </button>
        <button
          type="button"
          onClick={() => onRestock(item.item_id)}
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Restock 1
        </button>
      </div>
    </div>
  );
}
