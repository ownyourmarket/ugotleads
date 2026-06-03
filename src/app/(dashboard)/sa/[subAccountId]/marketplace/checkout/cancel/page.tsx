"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ShoppingBag, XCircle } from "lucide-react";
import { useSubAccount } from "@/context/sub-account-context";

export default function CheckoutCancelPage() {
  const searchParams = useSearchParams();
  const { subAccountId } = useSubAccount();
  const productId = searchParams?.get("productId") ?? null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">

        {/* Status card */}
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <XCircle className="h-8 w-8 text-zinc-500 dark:text-zinc-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Checkout canceled
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your checkout was canceled. No payment was taken and nothing was purchased.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {productId && (
            <Link
              href={`/sa/${subAccountId}/marketplace/products/${productId}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ArrowLeft className="h-4 w-4" />
              Return to product
            </Link>
          )}
          <Link
            href={`/sa/${subAccountId}/marketplace`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ShoppingBag className="h-4 w-4" />
            Back to Marketplace
          </Link>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Changed your mind? You can return to the product page and try again at any time.
        </p>
      </div>
    </div>
  );
}
