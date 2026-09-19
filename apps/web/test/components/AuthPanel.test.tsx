import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPanel } from "../../src/components/AuthPanel";

const signInMock = vi.fn();
const signUpMock = vi.fn();
const confirmSignUpMock = vi.fn();
const resendConfirmationCodeMock = vi.fn();
const completeNewPasswordMock = vi.fn();

vi.mock("../../src/state/AuthContext", () => ({
  useAuth: () => ({
    status: "signed_out",
    user: null,
    signIn: signInMock,
    signUp: signUpMock,
    confirmSignUp: confirmSignUpMock,
    resendConfirmationCode: resendConfirmationCodeMock,
    completeNewPassword: completeNewPasswordMock,
    signOut: vi.fn(),
  }),
}));

beforeEach(() => {
  signInMock.mockReset().mockResolvedValue({ newPasswordRequired: false });
  signUpMock.mockReset().mockResolvedValue({ shopId: "shop-abc123" });
  confirmSignUpMock.mockReset().mockResolvedValue(undefined);
  resendConfirmationCodeMock.mockReset().mockResolvedValue(undefined);
  completeNewPasswordMock.mockReset().mockResolvedValue(undefined);
});

describe("AuthPanel", () => {
  it("submits sign-in with the typed email and password", async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);

    await user.type(screen.getByLabelText(/^email$/i), "owner@shop.com");
    await user.type(screen.getByLabelText(/^password$/i), "Password1");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(signInMock).toHaveBeenCalledWith("owner@shop.com", "Password1");
  });

  it("shows an error when sign-in rejects", async () => {
    signInMock.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    render(<AuthPanel />);

    await user.type(screen.getByLabelText(/^email$/i), "owner@shop.com");
    await user.type(screen.getByLabelText(/^password$/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText(/couldn't sign in/i)).toBeInTheDocument();
  });

  it("switching to sign-up and submitting calls signUp with shop name, email, password, then advances to the confirm step", async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);

    await user.click(screen.getByText(/new shop\? create an account instead/i));
    await user.type(screen.getByLabelText(/shop name/i), "Kiran's Store");
    await user.type(screen.getByLabelText(/^email$/i), "owner@shop.com");
    await user.type(screen.getByLabelText(/^password$/i), "Password1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(signUpMock).toHaveBeenCalledWith({ email: "owner@shop.com", password: "Password1", shopName: "Kiran's Store" });
    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
  });

  it("submitting the confirmation code calls confirmSignUp and returns to the sign-in form", async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);

    await user.click(screen.getByText(/new shop\? create an account instead/i));
    await user.type(screen.getByLabelText(/shop name/i), "Kiran's Store");
    await user.type(screen.getByLabelText(/^email$/i), "owner@shop.com");
    await user.type(screen.getByLabelText(/^password$/i), "Password1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByRole("heading", { name: /check your email/i });
    await user.type(screen.getByLabelText(/confirmation code/i), "123456");
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(confirmSignUpMock).toHaveBeenCalledWith("owner@shop.com", "123456");
    expect(await screen.findByRole("heading", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("a NEW_PASSWORD_REQUIRED sign-in result shows the new-password step, and submitting it calls completeNewPassword", async () => {
    signInMock.mockResolvedValue({ newPasswordRequired: true, session: "session-token" });
    const user = userEvent.setup();
    render(<AuthPanel />);

    await user.type(screen.getByLabelText(/^email$/i), "staff@shop.com");
    await user.type(screen.getByLabelText(/^password$/i), "TempPass1");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await screen.findByRole("heading", { name: /choose a password/i });
    await user.type(screen.getByLabelText(/new password/i), "NewPassword1");
    await user.click(screen.getByRole("button", { name: /set password and continue/i }));

    expect(completeNewPasswordMock).toHaveBeenCalledWith("staff@shop.com", "NewPassword1", "session-token");
  });
});
