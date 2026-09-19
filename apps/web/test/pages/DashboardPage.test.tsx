import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "../../src/pages/DashboardPage";

const getDashboardMock = vi.fn();

vi.mock("../../src/api/client", () => ({
  getDashboard: (...args: unknown[]) => getDashboardMock(...args),
}));

const sampleData = {
  revenue: { total: 175, order_count: 3, average_order_value: 58.33, last_7_days: 150 },
  low_stock: [
    { item_id: "rice-5kg", name: "Rice 5kg", stock: 0 },
    { item_id: "milk-500ml", name: "Milk 500ml", stock: 2 },
  ],
  trust_score: { percent: 66.7, total_items: 3, items_with_open_conflict: 1 },
};

beforeEach(() => {
  getDashboardMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardPage", () => {
  it("requests the dashboard for the given shop and renders revenue, 7-day, trust score, and low-stock rows", async () => {
    getDashboardMock.mockResolvedValue(sampleData);
    render(<DashboardPage shopId="dash-shop" />);

    expect(await screen.findByText("₹175")).toBeInTheDocument();
    expect(screen.getByText("₹150")).toBeInTheDocument();
    expect(screen.getByText("66.7%")).toBeInTheDocument();
    expect(screen.getByText("Rice 5kg")).toBeInTheDocument();
    expect(screen.getByText("0 left")).toBeInTheDocument();
    expect(getDashboardMock).toHaveBeenCalledWith("dash-shop");
  });

  it("shows a friendly message when nothing is low on stock", async () => {
    getDashboardMock.mockResolvedValue({ ...sampleData, low_stock: [] });
    render(<DashboardPage shopId="dash-shop" />);

    expect(await screen.findByText(/nothing running low/i)).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    getDashboardMock.mockRejectedValue(new Error("boom"));
    render(<DashboardPage shopId="dash-shop" />);

    expect(await screen.findByText(/couldn't load the dashboard/i)).toBeInTheDocument();
  });
});
