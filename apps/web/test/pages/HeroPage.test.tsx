import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HeroPage } from "../../src/pages/HeroPage";
import { AuthProvider } from "../../src/state/AuthContext";
import { setTokens } from "../../src/lib/tokenStore";

afterEach(() => {
  setTokens(null);
});

describe("HeroPage", () => {
  it("renders the value proposition and how-it-works steps", () => {
    render(
      <AuthProvider>
        <HeroPage />
      </AuthProvider>,
    );

    expect(screen.getByRole("heading", { name: /inventory that never loses a sale/i })).toBeInTheDocument();
    expect(screen.getByText(/two counters go offline/i)).toBeInTheDocument();
  });

  it("defaults to the sign-in form", () => {
    render(
      <AuthProvider>
        <HeroPage />
      </AuthProvider>,
    );

    expect(screen.getByRole("heading", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("toggling to sign-up shows the shop-name field, and back again returns to sign-in", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <HeroPage />
      </AuthProvider>,
    );

    await user.click(screen.getByText(/new shop\? create an account instead/i));
    expect(screen.getByRole("heading", { name: /set up your shop/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/shop name/i)).toBeInTheDocument();

    await user.click(screen.getByText(/already have an account\? sign in/i));
    expect(screen.getByRole("heading", { name: /^sign in$/i })).toBeInTheDocument();
  });
});
