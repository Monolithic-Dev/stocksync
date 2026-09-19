import { useEffect, useState } from "react";
import type { Category, Product, Supplier } from "@stocksync/core";
import { categoriesApi, productsApi, suppliersApi } from "../api/client";
import { ProductForm, type ProductFormValues } from "../components/ProductForm";
import { useToast } from "../state/ToastContext";

export interface ProductsPageProps {
  shopId: string;
}

/**
 * Real product-catalog CRUD (19b) — turns the fixed demo item set into a
 * managed product catalog. Plain last-write-wins data (crudTable.ts),
 * deliberately not routed through the offline queue or the conflict-
 * resolution engine: catalog metadata isn't concurrently-edited live
 * state the way inventory_records is.
 */
export function ProductsPage({ shopId }: ProductsPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState(false);
  const { showToast } = useToast();

  async function reload(): Promise<void> {
    try {
      const [nextProducts, nextCategories, nextSuppliers] = await Promise.all([
        productsApi.list(shopId),
        categoriesApi.list(shopId),
        suppliersApi.list(shopId),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setSuppliers(nextSuppliers);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is stable per render, only shopId should re-trigger this
  }, [shopId]);

  async function handleCreate(values: ProductFormValues): Promise<void> {
    try {
      await productsApi.create(shopId, values);
      await reload();
      showToast(`Added ${values.name} to the catalog.`, "success");
    } catch {
      showToast("Couldn't add that product — check the connection and try again.", "error");
    }
  }

  async function handleDelete(productId: string, productName: string): Promise<void> {
    try {
      await productsApi.remove(shopId, productId);
      await reload();
      showToast(`Removed ${productName} from the catalog.`, "success");
    } catch {
      showToast("Couldn't remove that product — check the connection and try again.", "error");
    }
  }

  function categoryName(categoryId: string | undefined): string {
    return categories.find((category) => category.category_id === categoryId)?.name ?? "—";
  }

  function supplierName(supplierId: string | undefined): string {
    return suppliers.find((supplier) => supplier.supplier_id === supplierId)?.name ?? "—";
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-bold text-slate-900 dark:text-slate-100">Products</h1>

      {error && (
        <p className="mb-4 text-sm text-rose-600 dark:text-rose-400">Couldn't load the catalog. Check the connection and try again.</p>
      )}

      <div className="mb-4">
        <ProductForm categories={categories} suppliers={suppliers} onSubmit={(values) => void handleCreate(values)} />
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <th className="py-2">Name</th>
            <th className="py-2">SKU</th>
            <th className="py-2">Category</th>
            <th className="py-2">Supplier</th>
            <th className="py-2 text-right">Price</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr
              key={product.product_id}
              data-testid={`product-row-${product.product_id}`}
              className="border-b border-slate-100 dark:border-slate-800"
            >
              <td className="py-2 font-medium text-slate-900 dark:text-slate-100">{product.name}</td>
              <td className="py-2 text-slate-600 dark:text-slate-400">{product.sku ?? "—"}</td>
              <td className="py-2 text-slate-600 dark:text-slate-400">{categoryName(product.category_id)}</td>
              <td className="py-2 text-slate-600 dark:text-slate-400">{supplierName(product.supplier_id)}</td>
              <td className="py-2 text-right text-slate-900 dark:text-slate-100">
                {product.base_price !== undefined ? `₹${product.base_price}` : "—"}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => void handleDelete(product.product_id, product.name)}
                  className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {products.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-slate-400 dark:text-slate-500">
                No products yet — add one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
