import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeScanButton } from "../../src/components/BarcodeScanButton";
import type { DisplayItem } from "../../src/state/ShopContext";

type DecodeResult = { getText: () => string };
type DecodeCallback = (result: DecodeResult | undefined) => void;

let capturedCallback: DecodeCallback | undefined;
let decodeFromVideoDeviceImpl: () => Promise<{ stop: () => void }>;

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: vi.fn().mockImplementation(() => ({
    decodeFromVideoDevice: (
      _deviceId: string | undefined,
      _preview: unknown,
      callback: DecodeCallback,
    ) => {
      capturedCallback = callback;
      return decodeFromVideoDeviceImpl();
    },
  })),
}));

const items: DisplayItem[] = [
  { item_id: "parle-g", stock: 40, field_last_writer: {}, conflict_status: "none", vector_clock: {} },
];

beforeEach(() => {
  capturedCallback = undefined;
  decodeFromVideoDeviceImpl = vi.fn().mockResolvedValue({ stop: vi.fn() });
});

describe("BarcodeScanButton", () => {
  it("resolves a code matching a known item's item_id and calls onResolved", async () => {
    const onResolved = vi.fn();
    render(<BarcodeScanButton items={items} onResolved={onResolved} />);

    await userEvent.click(screen.getByRole("button", { name: /scan barcode\/qr/i }));
    await waitFor(() => expect(capturedCallback).toBeDefined());

    act(() => capturedCallback?.({ getText: () => "parle-g" }));

    expect(onResolved).toHaveBeenCalledWith("parle-g");
  });

  it("shows 'not recognized' and never calls onResolved for an unknown code", async () => {
    const onResolved = vi.fn();
    render(<BarcodeScanButton items={items} onResolved={onResolved} />);

    await userEvent.click(screen.getByRole("button", { name: /scan barcode\/qr/i }));
    await waitFor(() => expect(capturedCallback).toBeDefined());

    act(() => capturedCallback?.({ getText: () => "some-unrelated-code" }));

    expect(await screen.findByTestId("scan-not-recognized")).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("handles camera permission denial gracefully instead of throwing", async () => {
    decodeFromVideoDeviceImpl = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const onResolved = vi.fn();
    render(<BarcodeScanButton items={items} onResolved={onResolved} />);

    await userEvent.click(screen.getByRole("button", { name: /scan barcode\/qr/i }));

    expect(await screen.findByTestId("scan-permission-denied")).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });
});
