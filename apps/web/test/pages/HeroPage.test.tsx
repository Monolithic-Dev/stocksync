import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeroPage } from "../../src/pages/HeroPage";

describe("HeroPage", () => {
  it("renders the value proposition and how-it-works steps", () => {
    render(<HeroPage onEnter={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /inventory that never loses a sale/i })).toBeInTheDocument();
    expect(screen.getByText(/two counters go offline/i)).toBeInTheDocument();
  });

  it("entering as a preset counter calls onEnter with the demo shop and chosen counter", async () => {
    const user = userEvent.setup();
    const onEnter = vi.fn();
    render(<HeroPage onEnter={onEnter} />);

    await user.click(screen.getByRole("button", { name: /counter a/i }));

    expect(onEnter).toHaveBeenCalledWith("demo-shop", "counter_a");
  });

  it("entering with a custom shop/counter ID calls onEnter with the typed values", async () => {
    const user = userEvent.setup();
    const onEnter = vi.fn();
    render(<HeroPage onEnter={onEnter} />);

    await user.click(screen.getByText(/use a custom shop \/ counter id instead/i));
    await user.clear(screen.getByLabelText(/shop id/i));
    await user.type(screen.getByLabelText(/shop id/i), "other-shop");
    await user.type(screen.getByLabelText(/counter id/i), "counter_z");
    await user.click(screen.getByRole("button", { name: /enter/i }));

    expect(onEnter).toHaveBeenCalledWith("other-shop", "counter_z");
  });
});
