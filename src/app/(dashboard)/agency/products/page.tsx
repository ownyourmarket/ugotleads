"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  Eye,
  EyeOff,
  Package,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { subscribeToProducts, createProduct, updateProduct } from "@/lib/firestore/products";
import {
  checkSubscriptionReadiness,
  READINESS_BADGE,
} from "@/lib/products/subscription-readiness";
import type { Product, ProductStatus, AccessModel, ProductFamily } from "@/types/products";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRODUCT_FAMILIES: { value: ProductFamily; label: string }[] = [
  { value: "ugotleads_software", label: "uGotLeads Software" },
  { value: "myusa_education", label: "MyUSA Education" },
  { value: "myusa_services", label: "MyUSA Services" },
  { value: "myusa_resources", label: "MyUSA Resources" },
  { value: "myusa_media_products", label: "MyUSA Media Products" },
];

const ACCESS_MODELS: { value: AccessModel; label: string; hint: string }[] = [
  { value: "subscription", label: "Subscription", hint: "Recurring Stripe billing" },
  { value: "credit", label: "Credit", hint: "Deducted from credit wallet" },
  { value: "byok", label: "BYOK", hint: "Customer brings own key" },
];

const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

const STATUS_STYLES: Record<ProductStatus, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  archived: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

// ---------------------------------------------------------------------------
// Form state type
// ---------------------------------------------------------------------------

interface ProductForm {
  name: string;
  description: string;
  status: ProductStatus;
  accessModel: AccessModel;
  productFamily: ProductFamily | "";
  isPublic: boolean;
  isCommissionable: boolean;
  stripePriceIdMonthly: string;
  stripePriceIdAnnual: string;
  creditCostPerUnit: string;
  setupFeeCents: string;
  productOwner: string;
  productSource: string;
}

function emptyForm(): ProductForm {
  return {
    name: "",
    description: "",
    status: "draft",
    accessModel: "subscription",
    productFamily: "",
    isPublic: false,
    isCommissionable: true,
    stripePriceIdMonthly: "",
    stripePriceIdAnnual: "",
    creditCostPerUnit: "0",
    setupFeeCents: "0",
    productOwner: "",
    productSource: "",
  };
}

function productToForm(p: Product): ProductForm {
  return {
    name: p.name,
    description: p.description ?? "",
    status: p.status,
    accessModel: p.accessModel,
    productFamily: p.productFamily ?? "",
    isPublic: p.isPublic,
    isCommissionable: p.isCommissionable !== false, // undefined → true
    stripePriceIdMonthly: p.stripePriceIdMonthly ?? "",
    stripePriceIdAnnual: p.stripePriceIdAnnual ?? "",
    creditCostPerUnit: String(p.creditCostPerUnit ?? 0),
    setupFeeCents: String(p.setupFeeCents ?? 0),
    productOwner: p.productOwner ?? "",
    productSource: p.productSource ?? "",
  };
}

// ---------------------------------------------------------------------------
// Stripe price warning
// ---------------------------------------------------------------------------

function needsStripeWarning(form: ProductForm): boolean {
  return (
    form.accessModel === "subscription" &&
    form.status !== "archived" &&
    !form.stripePriceIdMonthly.trim() &&
    !form.stripePriceIdAnnual.trim()
  );
}

// ---------------------------------------------------------------------------
// Product form dialog
// ---------------------------------------------------------------------------

interface ProductFormDialogProps {
  product: Product | null; // null = creating
  agencyId: string;
  createdByUid: string;
  onClose: () => void;
}

function ProductFormDialog({ product, agencyId, createdByUid, onClose }: ProductFormDialogProps) {
  const isEditing = !!product;
  const [form, setForm] = useState<ProductForm>(
    product ? productToForm(product) : emptyForm(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function set<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Enforce: draft products cannot be public
      if (key === "status" && value === "draft") {
        next.isPublic = false;
      }
      if (key === "isPublic" && value === true && next.status === "draft") {
        return prev; // silently block
      }
      return next;
    });
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Product name is required.");
      return;
    }

    // Guard: prevent saving active + public subscription with no Stripe price IDs.
    // This catches the most dangerous accidental activation scenario.
    if (
      form.status === "active" &&
      form.isPublic &&
      form.accessModel === "subscription" &&
      !form.stripePriceIdMonthly.trim() &&
      !form.stripePriceIdAnnual.trim()
    ) {
      setError(
        "Cannot save an active + public subscription product without at least one Stripe price ID. " +
        "Add a price ID first, or change status to Draft.",
      );
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        status: form.status,
        accessModel: form.accessModel,
        productFamily: (form.productFamily as ProductFamily) || null,
        isPublic: form.status === "draft" ? false : form.isPublic,
        isCommissionable: form.isCommissionable,
        stripePriceIdMonthly: form.stripePriceIdMonthly.trim() || null,
        stripePriceIdAnnual: form.stripePriceIdAnnual.trim() || null,
        creditCostPerUnit: Math.max(0, Number(form.creditCostPerUnit) || 0),
        setupFeeCents: Math.max(0, Number(form.setupFeeCents) || 0),
        productOwner: form.productOwner.trim() || null,
        productSource: form.productSource.trim() || null,
      };

      if (isEditing && product) {
        await updateProduct(product.id, payload);
      } else {
        await createProduct({ ...payload, agencyId, createdByUid });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const showStripeWarning = needsStripeWarning(form);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-hidden border-l bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              {isEditing ? "Edit Product" : "New Product"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Stripe price warning */}
          {showStripeWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-700 dark:bg-amber-950/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                This subscription product has no Stripe price IDs. Checkout cannot be
                activated until at least one price ID is set.
              </p>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Product name <span className="text-destructive">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. DFY CRM Setup"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="Brief description shown on the marketplace product card."
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Status + Access model row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Status
              </label>
              <div className="relative">
                <select
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as ProductStatus)}
                  className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
              {form.status === "draft" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Draft products are never shown publicly.
                </p>
              )}
              {form.status === "archived" && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  Archived products cannot be purchased.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Access model
              </label>
              <div className="relative">
                <select
                  value={form.accessModel}
                  onChange={(e) => set("accessModel", e.target.value as AccessModel)}
                  className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {ACCESS_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {ACCESS_MODELS.find((m) => m.value === form.accessModel)?.hint}
              </p>
            </div>
          </div>

          {/* Product family */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Product family
            </label>
            <div className="relative">
              <select
                value={form.productFamily}
                onChange={(e) => set("productFamily", e.target.value as ProductFamily | "")}
                className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— Ungrouped —</option>
                {PRODUCT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* Subscription: Stripe price IDs */}
          {form.accessModel === "subscription" && (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Stripe price IDs
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Monthly price ID
                </label>
                <input
                  type="text"
                  value={form.stripePriceIdMonthly}
                  onChange={(e) => set("stripePriceIdMonthly", e.target.value)}
                  placeholder="price_..."
                  className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Annual price ID
                </label>
                <input
                  type="text"
                  value={form.stripePriceIdAnnual}
                  onChange={(e) => set("stripePriceIdAnnual", e.target.value)}
                  placeholder="price_..."
                  className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Copy from Stripe Dashboard → Product catalog → Price. Checkout will not
                activate unless at least one ID is set.
              </p>
            </div>
          )}

          {/* Credit model: credit cost */}
          {form.accessModel === "credit" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Credit cost per unit
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.creditCostPerUnit}
                onChange={(e) => set("creditCostPerUnit", e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          {/* Setup fee */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Setup fee (cents)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.setupFeeCents}
              onChange={(e) => set("setupFeeCents", e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              0 = no setup fee. Enter in cents (e.g. 9900 = $99.00).
            </p>
          </div>

          {/* Visibility + commissionable toggles */}
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Visibility &amp; commission
            </p>

            {/* Public toggle */}
            <label className={cn(
              "flex cursor-pointer items-center justify-between gap-3",
              form.status === "draft" && "cursor-not-allowed opacity-50",
            )}>
              <div>
                <p className="text-sm font-medium text-foreground">Public listing</p>
                <p className="text-xs text-muted-foreground">
                  {form.status === "draft"
                    ? "Unavailable — change status to Active first."
                    : "Show this product in the marketplace for all sub-accounts."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.isPublic}
                disabled={form.status === "draft"}
                onClick={() => set("isPublic", !form.isPublic)}
                className={cn(
                  "relative h-5 w-9 flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  form.isPublic
                    ? "bg-primary"
                    : "bg-muted-foreground/20",
                  form.status === "draft" && "pointer-events-none",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                    form.isPublic ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </button>
            </label>

            {/* Commissionable toggle */}
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Commission-eligible</p>
                <p className="text-xs text-muted-foreground">
                  Allow this product to generate commission events when purchased via a
                  partner referral. Commission rules still control the actual percentage.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.isCommissionable}
                onClick={() => set("isCommissionable", !form.isCommissionable)}
                className={cn(
                  "relative h-5 w-9 flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  form.isCommissionable ? "bg-primary" : "bg-muted-foreground/20",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                    form.isCommissionable ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </button>
            </label>
          </div>

          {/* Product owner + source */}
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Provenance
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Product owner
              </label>
              <input
                type="text"
                value={form.productOwner}
                onChange={(e) => set("productOwner", e.target.value)}
                placeholder="e.g. myusa_local or a uid"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Product source
              </label>
              <input
                type="text"
                value={form.productSource}
                onChange={(e) => set("productSource", e.target.value)}
                placeholder="e.g. myusa_local, partner_created, or URL"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : isEditing ? "Save changes" : "Create product"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type FilterStatus = "all" | ProductStatus;
type FilterFamily = "all" | ProductFamily;

export default function AgencyProductsPage() {
  const { agencyId, agencyRole, user } = useAuth();
  const isOwner = agencyRole === "owner";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterFamily, setFilterFamily] = useState<FilterFamily>("all");
  const [editingProduct, setEditingProduct] = useState<Product | null | "new">(null);
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId || !isOwner) { setLoading(false); return; }
    const unsub = subscribeToProducts(
      agencyId,
      (data) => { setProducts(data); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [agencyId, isOwner]);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  async function handleQuickStatusToggle(p: Product) {
    const next: ProductStatus = p.status === "active" ? "draft" : "active";
    const updates: Partial<Product> = { status: next };
    // If going to draft, also hide
    if (next === "draft") updates.isPublic = false;
    await updateProduct(p.id, updates);
    showToast(`"${p.name}" set to ${next}.`);
  }

  async function handleQuickPublicToggle(p: Product) {
    if (p.status === "draft") return; // guard
    await updateProduct(p.id, { isPublic: !p.isPublic });
    showToast(`"${p.name}" is now ${!p.isPublic ? "public" : "hidden"}.`);
  }

  async function handleArchive(id: string) {
    await updateProduct(id, { status: "archived", isPublic: false });
    setArchiveConfirm(null);
    showToast("Product archived.");
  }

  // Derived families for the family filter
  const presentFamilies = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((p) => p.productFamily)
            .filter((f): f is ProductFamily => !!f),
        ),
      ).sort(),
    [products],
  );

  const filtered = useMemo(() => {
    let list = products;
    if (filterStatus !== "all") list = list.filter((p) => p.status === filterStatus);
    if (filterFamily !== "all") list = list.filter((p) => p.productFamily === filterFamily);
    // sort: active first, then draft, then archived; within each by name
    return [...list].sort((a, b) => {
      const order: ProductStatus[] = ["active", "draft", "archived"];
      const ao = order.indexOf(a.status);
      const bo = order.indexOf(b.status);
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }, [products, filterStatus, filterFamily]);

  // Counts for filter chips
  const counts = useMemo(() => ({
    all: products.length,
    active: products.filter((p) => p.status === "active").length,
    draft: products.filter((p) => p.status === "draft").length,
    archived: products.filter((p) => p.status === "archived").length,
  }), [products]);

  if (!isOwner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Package className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">Agency owner access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Revenue OS — Agency</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your marketplace product catalog. Archive instead of deleting.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditingProduct("new")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New product
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status chips */}
        {(["all", "active", "draft", "archived"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilterStatus(s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filterStatus === s
                ? "bg-primary text-primary-foreground"
                : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s === "all" ? "All" : STATUS_LABELS[s]}
            <span className="ml-1.5 tabular-nums opacity-60">
              {s === "all" ? counts.all : counts[s]}
            </span>
          </button>
        ))}

        {/* Divider */}
        {presentFamilies.length > 0 && (
          <span className="mx-1 text-muted-foreground/30">|</span>
        )}

        {/* Family chips */}
        {presentFamilies.map((f) => {
          const meta = PRODUCT_FAMILIES.find((pf) => pf.value === f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilterFamily(filterFamily === f ? "all" : f)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filterFamily === f
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {meta?.label ?? f}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {filterStatus !== "all" || filterFamily !== "all"
                ? "No products match this filter."
                : "No products yet."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {filterStatus !== "all" || filterFamily !== "all"
                ? "Clear filters to see all products."
                : "Create your first product to start building your marketplace."}
            </p>
          </div>
          {filterStatus !== "all" || filterFamily !== "all" ? (
            <button
              type="button"
              onClick={() => { setFilterStatus("all"); setFilterFamily("all"); }}
              className="text-xs text-primary underline underline-offset-2"
            >
              Clear filters
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditingProduct("new")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New product
            </button>
          )}
        </div>
      )}

      {/* Product table */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Family</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Public</th>
                  <th className="px-4 py-3 font-medium">Stripe prices</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Readiness</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((p) => {
                  const hasStripeWarning =
                    p.accessModel === "subscription" &&
                    p.status !== "archived" &&
                    !p.stripePriceIdMonthly &&
                    !p.stripePriceIdAnnual;
                  const familyLabel = PRODUCT_FAMILIES.find(
                    (f) => f.value === p.productFamily,
                  )?.label;
                  const isCommissionable = p.isCommissionable !== false;
                  return (
                    <tr key={p.id} className={cn("hover:bg-muted/20", p.status === "archived" && "opacity-60")}>
                      {/* Product name */}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <div>
                            <p className="font-medium text-foreground">{p.name}</p>
                            {p.description && (
                              <p className="mt-0.5 max-w-[240px] truncate text-xs text-muted-foreground">
                                {p.description}
                              </p>
                            )}
                            {hasStripeWarning && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3" />
                                No Stripe price IDs
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Family */}
                      <td className="px-4 py-3">
                        {familyLabel ? (
                          <span className="text-xs text-muted-foreground">{familyLabel}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {/* Access model */}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {p.accessModel}
                        </span>
                      </td>

                      {/* Status — clickable toggle (active ↔ draft only) */}
                      <td className="px-4 py-3">
                        {p.status === "archived" ? (
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            STATUS_STYLES.archived,
                          )}>
                            Archived
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleQuickStatusToggle(p)}
                            title={`Click to set ${p.status === "active" ? "Draft" : "Active"}`}
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-70",
                              STATUS_STYLES[p.status],
                            )}
                          >
                            {STATUS_LABELS[p.status]}
                          </button>
                        )}
                      </td>

                      {/* Public toggle */}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          disabled={p.status === "draft" || p.status === "archived"}
                          onClick={() => handleQuickPublicToggle(p)}
                          title={
                            p.status === "draft"
                              ? "Draft products cannot be public"
                              : p.isPublic
                                ? "Click to hide"
                                : "Click to make public"
                          }
                          className={cn(
                            "rounded-md p-1 transition-colors",
                            p.status === "draft" || p.status === "archived"
                              ? "cursor-not-allowed text-muted-foreground/30"
                              : p.isPublic
                                ? "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                                : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {p.isPublic ? (
                            <Eye className="h-4 w-4" />
                          ) : (
                            <EyeOff className="h-4 w-4" />
                          )}
                        </button>
                      </td>

                      {/* Stripe prices */}
                      <td className="px-4 py-3">
                        {p.accessModel !== "subscription" ? (
                          <span className="text-xs text-muted-foreground/40">N/A</span>
                        ) : (
                          <div className="space-y-0.5">
                            {p.stripePriceIdMonthly ? (
                              <code className="block text-[11px] text-muted-foreground">
                                Mo: {p.stripePriceIdMonthly.slice(0, 14)}…
                              </code>
                            ) : (
                              <span className="block text-[11px] text-muted-foreground/40">Mo: —</span>
                            )}
                            {p.stripePriceIdAnnual ? (
                              <code className="block text-[11px] text-muted-foreground">
                                Yr: {p.stripePriceIdAnnual.slice(0, 14)}…
                              </code>
                            ) : (
                              <span className="block text-[11px] text-muted-foreground/40">Yr: —</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Commission-eligible */}
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            isCommissionable
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                          )}
                        >
                          {isCommissionable ? "Yes" : "No"}
                        </span>
                      </td>

                      {/* Readiness badge */}
                      <td className="px-4 py-3">
                        {(() => {
                          const readiness = checkSubscriptionReadiness(p);
                          const badge = READINESS_BADGE[readiness.state];
                          return (
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                badge.className,
                              )}
                              title={readiness.blockers[0] ?? readiness.warnings[0]}
                            >
                              {badge.label}
                            </span>
                          );
                        })()}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingProduct(p)}
                            title="Edit"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {p.status !== "archived" && (
                            <button
                              type="button"
                              onClick={() => setArchiveConfirm(p.id)}
                              title="Archive"
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Archive confirm */}
      {archiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setArchiveConfirm(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-2">
              <Archive className="h-5 w-5 text-amber-600" />
              <h3 className="text-sm font-semibold text-foreground">Archive product?</h3>
            </div>
            <p className="mb-6 text-sm text-muted-foreground">
              This sets the product to <strong>archived</strong> and hides it from the
              marketplace. No data is deleted. You can restore it by editing the status.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setArchiveConfirm(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleArchive(archiveConfirm)}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product form panel */}
      {editingProduct !== null && (
        <ProductFormDialog
          product={editingProduct === "new" ? null : editingProduct}
          agencyId={agencyId ?? ""}
          createdByUid={user?.uid ?? ""}
          onClose={() => setEditingProduct(null)}
        />
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border bg-card px-4 py-3 shadow-lg">
          <p className="text-sm font-medium text-foreground">{toastMsg}</p>
        </div>
      )}
    </div>
  );
}
