import { useState } from "react";
import type { Category, Supplier } from "@stocksync/core";

export interface ProductFormValues {
  name: string;
  sku?: string;
  category_id?: string;
  supplier_id?: string;
  base_price?: number;
}

export interface ProductFormProps {
  categories: Category[];
  suppliers: Supplier[];
  onSubmit: (values: ProductFormValues) => void;
}

/** Create-product form for ProductsPage — plain last-write-wins catalog data, no offline queue involved (19b). */
export function ProductForm({ categories, suppliers, onSubmit }: ProductFormProps) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [basePrice, setBasePrice] = useState("");

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (name.trim() === "") return;
    onSubmit({
      name: name.trim(),
      sku: sku.trim() || undefined,
      category_id: categoryId || undefined,
      supplier_id: supplierId || undefined,
      base_price: basePrice ? Number(basePrice) : undefined,
    });
    setName("");
    setSku("");
    setCategoryId("");
    setSupplierId("");
    setBasePrice("");
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-5">
      <input
        data-testid="product-name-input"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="col-span-2 rounded border border-slate-300 px-2 py-1 text-sm sm:col-span-1"
      />
      <input
        data-testid="product-sku-input"
        placeholder="SKU"
        value={sku}
        onChange={(event) => setSku(event.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      />
      <select
        data-testid="product-category-select"
        value={categoryId}
        onChange={(event) => setCategoryId(event.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="">Category</option>
        {categories.map((category) => (
          <option key={category.category_id} value={category.category_id}>
            {category.name}
          </option>
        ))}
      </select>
      <select
        data-testid="product-supplier-select"
        value={supplierId}
        onChange={(event) => setSupplierId(event.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="">Supplier</option>
        {suppliers.map((supplier) => (
          <option key={supplier.supplier_id} value={supplier.supplier_id}>
            {supplier.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          data-testid="product-price-input"
          type="number"
          placeholder="₹"
          value={basePrice}
          onChange={(event) => setBasePrice(event.target.value)}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700">
          Add
        </button>
      </div>
    </form>
  );
}
