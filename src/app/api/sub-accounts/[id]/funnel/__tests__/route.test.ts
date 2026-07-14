import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, resetFakeDb } from "@/test/fake-admin";
import type { FormSettings } from "@/types/forms";
import type { WebsiteConfig } from "@/types/website";

type StoredForm = {
  settings: FormSettings;
  subAccountId: string;
  agencyId: string;
};

vi.mock("@/lib/firebase/admin", async () => {
  const { fakeDb } = await import("@/test/fake-admin");
  return {
    getAdminDb: () => fakeDb,
    getAdminAuth: () => ({
      getUser: async (uid: string) => {
        if (uid === "owner1")
          return {
            customClaims: {
              status: "active",
              agencyId: "ag1",
              agencyRole: "owner",
            },
          };
        return {
          customClaims: {
            status: "active",
            agencyId: "ag1",
            agencyRole: null,
          },
        };
      },
    }),
  };
});

const submitBuild = vi.fn();
const gitpageIsConfigured = vi.fn(() => true);

vi.mock("@/lib/gitpage/client", () => ({
  gitpageIsConfigured: () => gitpageIsConfigured(),
  submitBuild: (...args: unknown[]) => submitBuild(...args),
  GitpageError: class GitpageError extends Error {
    status: number;
    body: Record<string, unknown>;
    constructor(
      message: string,
      status: number,
      body: Record<string, unknown>,
    ) {
      super(message);
      this.name = "GitpageError";
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock("@/lib/gitpage/heartbeat", () => ({
  markGitpageBuildSucceeded: vi.fn(async () => {}),
  markGitpageKeyInvalid: vi.fn(async () => {}),
}));

vi.mock("@/lib/automations/qstash", () => ({
  qstashIsConfigured: () => false,
  publishCallback: vi.fn(async () => {}),
}));

import { POST } from "@/app/api/sub-accounts/[id]/funnel/route";
import { GitpageError } from "@/lib/gitpage/client";

function vslConfig(): WebsiteConfig {
  return {
    site_type: "LocalSite",
    build_type: "vsl",
    niche: null,
    language: "English",
    heading: "MyUSA 365 OS",
    color_scheme: "Standard",
    hero_statement: "Own the OS that runs your local market",
    features: "OS access, 4 modules, certification",
    benefits: "One login, one fee, keep revenue",
    contact_details: "ops@example.com",
    cta_link: "https://example.com/will-be-replaced",
    include_faq: true,
    video_link: "https://www.youtube.com/embed/abc123",
    local_page_selections: {
      index: true,
      services: false,
      contact: false,
      privacy: false,
      terms: false,
    },
    services_config: null,
    business_details: null,
    design_color_palette: "Modern & Clean",
    custom_colors: "",
    design_typography: "Modern Sans-Serif",
    design_layout: "Single Column",
    design_components: "Cards",
    design_interactions: "Subtle",
    design_buttons: "Rounded",
    design_contact_form: "Simple",
    design_icons: "Line Icons",
    astra_theme: false,
  };
}

function funnelReq(uid: string, body: unknown): Request {
  return new Request("http://test/api/sub-accounts/sub1/funnel", {
    method: "POST",
    headers: { "x-user-uid": uid, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "sub1" }) };

async function formDocs() {
  const snap = await fakeDb.collection("forms").get();
  return snap.docs;
}

describe("one-click funnel route", () => {
  beforeEach(() => {
    resetFakeDb();
    vi.clearAllMocks();
    gitpageIsConfigured.mockReturnValue(true);
    submitBuild.mockResolvedValue({
      formResponseId: "build_test1",
      pollUrl: "https://www.gitpage.site/api/v1/page-status?x",
      pollIntervalSeconds: 20,
      estimatedDurationSeconds: 300,
    });
    process.env.NEXT_PUBLIC_APP_URL = "http://test";
    fakeDb.doc("subAccounts/sub1").set({ agencyId: "ag1", name: "Main St" });
    fakeDb
      .doc("subAccounts/sub1/subAccountMembers/collab1")
      .set({ status: "active", role: "collaborator" });
  });

  it("creates the form, wires the CTA to it, and queues the build", async () => {
    const res = await POST(
      funnelReq("owner1", { name: "365 OS Funnel", config: vslConfig() }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");
    expect(body.formId).toBeDefined();
    expect(body.formUrl).toBe(`http://test/f/${body.formId}`);

    const form = await fakeDb.doc(`forms/${body.formId}`).get();
    expect(form.exists).toBe(true);
    const formData = form.data() as StoredForm;
    expect(formData.settings.autoTags).toContain("funnel");
    expect(formData.settings.createDeal).toBe(true);
    expect(formData.subAccountId).toBe("sub1");
    expect(formData.agencyId).toBe("ag1");

    // The submitted config's CTA must be the hosted form page.
    expect(submitBuild).toHaveBeenCalledTimes(1);
    const submitted = submitBuild.mock.calls[0][0] as {
      config: WebsiteConfig;
    };
    expect(submitted.config.cta_link).toBe(body.formUrl);

    const site = await fakeDb.doc("subAccounts/sub1/website/main").get();
    expect(site.exists).toBe(true);
    const siteData = site.data() as { status: string; config: WebsiteConfig };
    expect(siteData.status).toBe("queued");
    expect(siteData.config.cta_link).toBe(body.formUrl);
  });

  it("applies form overrides (redirectUrl, dealValue)", async () => {
    const res = await POST(
      funnelReq("owner1", {
        name: "365 OS Funnel",
        config: vslConfig(),
        form: {
          redirectUrl: "https://example.com/thank-you",
          dealValue: 497,
          createDeal: false,
        },
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const form = await fakeDb.doc(`forms/${body.formId}`).get();
    const formData = form.data() as StoredForm;
    expect(formData.settings.redirectUrl).toBe(
      "https://example.com/thank-you",
    );
    expect(formData.settings.dealValue).toBe(497);
    expect(formData.settings.createDeal).toBe(false);
  });

  it("rejects a non-http redirectUrl before creating anything", async () => {
    const res = await POST(
      funnelReq("owner1", {
        name: "x",
        config: vslConfig(),
        form: { redirectUrl: "javascript:alert(1)" },
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(await formDocs()).toHaveLength(0);
  });

  it("deletes the form when gitpage rejects the build", async () => {
    submitBuild.mockRejectedValueOnce(
      new GitpageError("validation failed", 400, {}),
    );
    const res = await POST(
      funnelReq("owner1", { name: "365 OS Funnel", config: vslConfig() }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(await formDocs()).toHaveLength(0);
  });

  it("403s for a collaborator (admin only)", async () => {
    const res = await POST(
      funnelReq("collab1", { name: "365 OS Funnel", config: vslConfig() }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(await formDocs()).toHaveLength(0);
  });

  it("400s on a missing name", async () => {
    const res = await POST(funnelReq("owner1", { config: vslConfig() }), ctx);
    expect(res.status).toBe(400);
    expect(await formDocs()).toHaveLength(0);
  });

  it("503s when gitpage is not configured", async () => {
    gitpageIsConfigured.mockReturnValue(false);
    const res = await POST(
      funnelReq("owner1", { name: "x", config: vslConfig() }),
      ctx,
    );
    expect(res.status).toBe(503);
    expect(await formDocs()).toHaveLength(0);
  });
});
