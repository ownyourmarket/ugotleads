"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

/**
 * Live white-label brand name for a sub-account, or null when the workspace
 * uses default agency branding. Used by the sidebar (which mounts outside
 * <SubAccountProvider/>) to show a reselling partner's brand to everyone
 * working inside one of their client workspaces.
 *
 * Reads the same subAccounts/{id} doc members can already read — no new
 * rules surface. Errors (e.g. brief permission race during sign-out) fall
 * back silently to default branding.
 */
export function useSubAccountBrand(subAccountId: string | null): string | null {
  const [brandName, setBrandName] = useState<string | null>(null);

  useEffect(() => {
    if (!subAccountId) {
      setBrandName(null);
      return;
    }
    const ref = doc(getFirebaseDb(), `subAccounts/${subAccountId}`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const name = snap.exists()
          ? ((snap.data().whiteLabelBrandName as string | undefined) ?? null)
          : null;
        setBrandName(name && name.trim() ? name.trim() : null);
      },
      () => setBrandName(null),
    );
    return () => unsub();
  }, [subAccountId]);

  return brandName;
}
