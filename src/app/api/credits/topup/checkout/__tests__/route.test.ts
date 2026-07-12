import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return { getAdminDb: () => fakeDb, getAdminAuth: () => ({}) };
});

const requireSubAccountMemberMock = vi.fn();
vi.mock("@/lib/auth/require-tenancy", () => ({
  requireSubAccountMember: (...args: unknown[]) =>
    requireSubAccountMemberMock(...args),
}));

const createSessionMock = vi.fn();
vi.mock("@/lib/stripe/server", () => ({
  getStripeServer: () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => createSessionMock(...args),
      },
    },
  }),
}));

import { POST } from "@/app/api/credits/topup/checkout/route";

function req(body: unknown): Request {
  return new Request("http://test/api/credits/topup/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  requireSubAccountMemberMock.mockReset();
  createSessionMock.mockReset();
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
});

describe("POST /api/credits/topup/checkout", () => {
  it("400s on an unknown packId", async () => {
    requireSubAccountMemberMock.mockResolvedValue({ uid: "u1", subAccountId: "subA" });
    fakeDb.doc("subAccounts/subA").set({ agencyId: "ag1" });

    const res = await POST(req({ packId: "bogus", subAccountId: "subA" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_pack");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("short-circuits on auth failure without touching Stripe", async () => {
    requireSubAccountMemberMock.mockResolvedValue(
      NextResponse.json({ error: "Not a member" }, { status: 403 }),
    );

    const res = await POST(req({ packId: "growth", subAccountId: "subA" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not a member");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("409s when the caller's wallet is already bound to a different sub-account", async () => {
    requireSubAccountMemberMock.mockResolvedValue({ uid: "u1", subAccountId: "subA" });
    fakeDb.doc("subAccounts/subA").set({ agencyId: "ag1" });
    fakeDb.doc("credit_wallets/u1").set({ subAccountId: "subOther" });

    const res = await POST(req({ packId: "growth", subAccountId: "subA" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("wallet_bound_elsewhere");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("allows checkout when the wallet is unbound (subAccountId null) or already matches", async () => {
    requireSubAccountMemberMock.mockResolvedValue({ uid: "u1", subAccountId: "subA" });
    fakeDb.doc("subAccounts/subA").set({ agencyId: "ag1" });
    fakeDb.doc("credit_wallets/u1").set({ subAccountId: null });
    createSessionMock.mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/pay/cs_test_1",
    });

    const res = await POST(req({ packId: "growth", subAccountId: "subA" }));

    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("creates a session on the happy path with mode=payment, correct unit_amount, and all six metadata fields", async () => {
    requireSubAccountMemberMock.mockResolvedValue({ uid: "u1", subAccountId: "subA" });
    fakeDb.doc("subAccounts/subA").set({ agencyId: "ag1" });
    createSessionMock.mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/pay/cs_test_1",
    });

    const res = await POST(req({ packId: "growth", subAccountId: "subA" }));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://checkout.stripe.com/pay/cs_test_1");

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const call = createSessionMock.mock.calls[0][0];
    expect(call.mode).toBe("payment");
    expect(call.line_items[0].price_data.unit_amount).toBe(4900);
    expect(call.metadata).toEqual({
      kind: "credit_topup",
      packId: "growth",
      credits: "2000",
      agencyId: "ag1",
      subAccountId: "subA",
      purchaserUid: "u1",
    });
  });

  it("502s when Stripe session creation fails", async () => {
    requireSubAccountMemberMock.mockResolvedValue({ uid: "u1", subAccountId: "subA" });
    fakeDb.doc("subAccounts/subA").set({ agencyId: "ag1" });
    createSessionMock.mockRejectedValue(new Error("stripe down"));

    const res = await POST(req({ packId: "growth", subAccountId: "subA" }));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("checkout_unavailable");
  });

  it("500s when the Firestore read fails", async () => {
    requireSubAccountMemberMock.mockResolvedValue({ uid: "u1", subAccountId: "subA" });
    const docSpy = vi.spyOn(fakeDb, "doc").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const res = await POST(req({ packId: "growth", subAccountId: "subA" }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("internal");
    expect(createSessionMock).not.toHaveBeenCalled();
    docSpy.mockRestore();
  });
});
