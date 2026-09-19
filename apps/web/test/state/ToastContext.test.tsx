import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../../src/state/ToastContext";
import { ToastContainer } from "../../src/components/ToastContainer";

function ToastProbe() {
  const { showToast } = useToast();
  return (
    <div>
      <button type="button" onClick={() => showToast("Saved successfully", "success")}>
        Fire success
      </button>
      <button type="button" onClick={() => showToast("Something broke", "error")}>
        Fire error
      </button>
    </div>
  );
}

function renderWithToasts() {
  return render(
    <ToastProvider>
      <ToastProbe />
      <ToastContainer />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastContext / ToastContainer", () => {
  it("renders nothing when the queue is empty", () => {
    renderWithToasts();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pushing a toast renders it with the right message and variant styling hook", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: /fire success/i }));

    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();
  });

  it("multiple toasts stack in the order they were fired", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: /fire success/i }));
    await user.click(screen.getByRole("button", { name: /fire error/i }));

    const toasts = await screen.findAllByRole("status");
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toHaveTextContent("Saved successfully");
    expect(toasts[1]).toHaveTextContent("Something broke");
  });

  it("a toast auto-dismisses after its timeout", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: /fire success/i }));
    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4100);
    });

    await waitFor(() => expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument());
  });

  it("clicking the dismiss button removes the toast immediately", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: /fire success/i }));
    await screen.findByText("Saved successfully");

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument();
  });
});
