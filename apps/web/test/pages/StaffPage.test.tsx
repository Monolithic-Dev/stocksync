import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaffPage } from "../../src/pages/StaffPage";

const postStaffInviteMock = vi.fn();

vi.mock("../../src/api/client", () => ({
  postStaffInvite: (...args: unknown[]) => postStaffInviteMock(...args),
}));

beforeEach(() => {
  postStaffInviteMock.mockReset();
});

describe("StaffPage", () => {
  it("invites a staff member with the chosen role and lists them on success", async () => {
    postStaffInviteMock.mockResolvedValue({ email: "manager@shop.com", role: "manager", shop_id: "demo-shop" });
    const user = userEvent.setup();
    render(<StaffPage />);

    await user.type(screen.getByLabelText(/email/i), "manager@shop.com");
    await user.selectOptions(screen.getByLabelText(/role/i), "manager");
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    expect(postStaffInviteMock).toHaveBeenCalledWith("manager@shop.com", "manager");
    expect(await screen.findByText("manager@shop.com")).toBeInTheDocument();
  });

  it("defaults to inviting counter staff", async () => {
    postStaffInviteMock.mockResolvedValue({ email: "clerk@shop.com", role: "counter_staff", shop_id: "demo-shop" });
    const user = userEvent.setup();
    render(<StaffPage />);

    await user.type(screen.getByLabelText(/email/i), "clerk@shop.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    expect(postStaffInviteMock).toHaveBeenCalledWith("clerk@shop.com", "counter_staff");
  });

  it("shows an error when the invite fails", async () => {
    postStaffInviteMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<StaffPage />);

    await user.type(screen.getByLabelText(/email/i), "bad@shop.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    expect(await screen.findByText(/couldn't invite that person/i)).toBeInTheDocument();
  });
});
