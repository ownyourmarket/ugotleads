"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, ShoppingBag, Layers } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { subscribeToProducts } from "@/lib/firestore/products";
import type { Product, ProductFamily, AccessModel } from "@/types/products";
import { ProductCard, FAMILY_LABELS, FAMILY_COLORS } from "@/components/marketplace/product-card";
import { AccessModelSelector } from "@/components/marketplace/access-model-selector";
import { PartnerBanner } from "@/components/marketplace/partner-banner";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Family ordering — controls display order on the page
// ---------------------------------------------------------------------------

const FAMILY_ORDER: ProductFamily[] = [
  "ugotleads_software",
  "myusa_education",
  "myusa_services",
  "myusa_resources",
  "myusa_media_products",
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketplacePage() {
  const { agencyId, agencyRole } = useAuth();
  const { agencyId: saAgencyId } = useSubAccount();

  const effectiveAgencyId = agencyId ?? saAgencyId;
  const isAdmin = agencyRole === "owner";

  // All products from Firestore
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Access model filter
  const [selectedModel, setSelectedModel] = useState<AccessModel | null>(null);

  // Family filter
  const [selectedFamily, setSelectedFamily] = useState<ProductFamily | null>(null);

  // ---- Firestore subscription ----
  useEffect(() => {
    if (!effectiveAgencyId) return;

    const unsub = subscribeToProducts(
      effectiveAgencyId,
      (products) => {
        setAllProducts(products);
        setLoading(false);
      },
      (err) => {
        console.error("[marketplace] subscribeToProducts error:", err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [effectiveAgencyId]);

  // ---- Derived: public products (for regular view) ----
  const publicProducts = useMemo(
    () => allProducts.filter((p) => p.isPublic && p.status === "active"),
    [allProducts],
  );

  // ---- Derived: draft/hidden products (admin-only section) ----
  const draftProducts = useMemo(
    () =>
      isAdmin
        ? allProducts.filter((p) => !p.isPublic || p.status !== "active")
        : [],
    [allProducts, isAdmin],
  );

  // ---- Derived: filtered products ----
  const filteredPublic = useMemo(() => {
    let result = publicProducts;
    if (selectedModel) result = result.filter((p) => p.accessModel === selectedModel);
    if (selectedFamily) result = result.filter((p) => p.productFamily === selectedFamily);
    return result;
  }, [publicProducts, selectedModel, selectedFamily]);

  // ---- Derived: products grouped by family ----
  const groupedProducts = useMemo(() => {
    const groups: Record<ProductFamily, Product[]> = {
      ugotleads_software: [],
      myusa_education: [],
      myusa_services: [],
      myusa_resources: [],
      myusa_media_products: [],
    };
    for (const p of filteredPublic) {
      const family = p.productFamily;
      if (family && family in groups) {
        groups[family].push(p);
      }
    }
    return groups;
  }, [filteredPublic]);

  const activeFamily = useMemo(
    () =>
      FAMILY_ORDER.filter(
        (f) => groupedProducts[f].length > 0,
      ),
    [groupedProducts],
  );

  // ---- Stat counts ----
  const totalPublic = publicProducts.length;
  const totalDraft = draftProducts.length;

  return (
    <div className="min-h-screen space-y-8 p-6">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-sm font-medium uppercase tracking-wider">
              Revenue OS
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Product Marketplace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore and access products from MyUSA Local and uGotLeads.
          </p>
        </div>

        {/* Stat chips */}
        {!loading && (
          <div className="flex items-center gap-3">
            <div className="rounded-lg border bg-card px-3 py-2 text-center">
              <p className="text-lg font-bold tabular-nums text-foreground">
                {totalPublic}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Available
              </p>
            </div>
            {isAdmin && totalDraft > 0 && (
              <div className="rounded-lg border bg-card px-3 py-2 text-center">
                <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {totalDraft}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Draft
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Partner banner ---- */}
      {/*
        TODO: Replace isPartner and activeTrackId with real partner profile data.
        Once src/lib/firestore/partners.ts is built and a usePartnerProfile() hook exists,
        read PartnerProfile.status === "active" → isPartner, and PartnerProfile.activeTrackId.
        Do NOT fake permissions. Until then, this banner safely renders nothing.
      */}
      <PartnerBanner
        isPartner={false}
        activeTrackId={null}
        loading={false}
      />

      {/* ---- Access model selector ---- */}
      <section>
        <AccessModelSelector
          selected={selectedModel}
          onSelect={(m) =>
            setSelectedModel((prev) => (prev === m ? null : m))
          }
        />
      </section>

      {/* ---- Family filter pills ---- */}
      {!loading && totalPublic > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedFamily(null)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              selectedFamily === null
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            All families
          </button>
          {FAMILY_ORDER.filter((f) => publicProducts.some((p) => p.productFamily === f)).map(
            (family) => {
              const style = FAMILY_COLORS[family];
              return (
                <button
                  key={family}
                  type="button"
                  onClick={() =>
                    setSelectedFamily((prev) =>
                      prev === family ? null : family,
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    selectedFamily === family
                      ? style.badge + " border-transparent"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      selectedFamily === family ? "" : style.dot,
                    )}
                  />
                  {FAMILY_LABELS[family]}
                </button>
              );
            },
          )}
        </div>
      )}

      {/* ---- Loading skeleton ---- */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-xl border bg-muted/40"
            />
          ))}
        </div>
      )}

      {/* ---- No results ---- */}
      {!loading && filteredPublic.length === 0 && totalPublic > 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No products match the selected filters.
          </p>
          <button
            type="button"
            className="text-xs text-primary underline underline-offset-2"
            onClick={() => {
              setSelectedModel(null);
              setSelectedFamily(null);
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ---- Empty state (no seeded products) ---- */}
      {!loading && totalPublic === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
          <Package className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">
            No products available yet.
          </p>
          <p className="text-xs text-muted-foreground">
            Run the Revenue OS seed to populate the product catalog.
          </p>
        </div>
      )}

      {/* ---- Products grouped by family ---- */}
      {!loading && activeFamily.length > 0 && (
        <div className="space-y-10">
          {activeFamily.map((family) => {
            const products = groupedProducts[family];
            const style = FAMILY_COLORS[family];

            return (
              <section key={family}>
                {/* Section header */}
                <div className="mb-4 flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full flex-shrink-0",
                      style.dot,
                    )}
                  />
                  <h2 className="text-base font-semibold text-foreground">
                    {FAMILY_LABELS[family]}
                  </h2>
                  <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {products.length}
                  </span>
                </div>

                {/* Product grid */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ---- Admin: draft / hidden products ---- */}
      {isAdmin && !loading && draftProducts.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400 flex-shrink-0" />
            <h2 className="text-base font-semibold text-foreground">
              Draft / Hidden
            </h2>
            <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
              {draftProducts.length}
            </span>
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Admin only
            </span>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            These products are not visible to partners or marketplace visitors.
            Activate them once Stripe price IDs and public settings are
            configured.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {draftProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                isAdmin={true}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
