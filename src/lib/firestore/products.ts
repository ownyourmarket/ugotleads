// src/lib/firestore/products.ts
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { Product, ProductEligibility, EligibilityStatus, ProductFamily } from "@/types/products";

const PRODUCTS = "products";
const PRODUCT_ELIGIBILITY = "product_eligibility";

// ---------------------------------------------------------------------------
// products
// ---------------------------------------------------------------------------

export function subscribeToProducts(
  agencyId: string,
  callback: (products: Product[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PRODUCTS),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }))),
    (err) => onError?.(err),
  );
}

export async function getProduct(id: string): Promise<Product | null> {
  const snap = await getDoc(doc(getFirebaseDb(), PRODUCTS, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Product, "id">) };
}

export async function createProduct(
  data: Omit<Product, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const ref = await addDoc(collection(getFirebaseDb(), PRODUCTS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProduct(
  id: string,
  data: Partial<Omit<Product, "id" | "agencyId" | "createdAt" | "updatedAt">>,
): Promise<void> {
  await updateDoc(doc(getFirebaseDb(), PRODUCTS, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// product_eligibility  (doc id is deterministic)
// ---------------------------------------------------------------------------

export function eligibilityDocId(partnerProfileId: string, productId: string): string {
  return `${partnerProfileId}_${productId}`;
}

export async function getProductEligibility(
  partnerProfileId: string,
  productId: string,
): Promise<ProductEligibility | null> {
  const snap = await getDoc(
    doc(getFirebaseDb(), PRODUCT_ELIGIBILITY, eligibilityDocId(partnerProfileId, productId)),
  );
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<ProductEligibility, "id">) };
}

export async function setProductEligibility(
  data: Omit<ProductEligibility, "id" | "createdAt" | "updatedAt">,
): Promise<void> {
  const id = eligibilityDocId(data.partnerProfileId, data.productId);
  await setDoc(
    doc(getFirebaseDb(), PRODUCT_ELIGIBILITY, id),
    { ...data, id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function updateProductEligibility(
  partnerProfileId: string,
  productId: string,
  data: Partial<Pick<
    ProductEligibility,
    "status" | "reviewedByUid" | "reviewedAt" | "reviewNote" | "expiresAt"
  >>,
): Promise<void> {
  await updateDoc(
    doc(getFirebaseDb(), PRODUCT_ELIGIBILITY, eligibilityDocId(partnerProfileId, productId)),
    { ...data, updatedAt: serverTimestamp() },
  );
}

export function subscribeToPartnerEligibilities(
  partnerProfileId: string,
  callback: (items: ProductEligibility[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PRODUCT_ELIGIBILITY),
    where("partnerProfileId", "==", partnerProfileId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductEligibility, "id">) }))),
    (err) => onError?.(err),
  );
}

// ---------------------------------------------------------------------------
// Product catalog queries — by family / owner / source
// ---------------------------------------------------------------------------

/**
 * Real-time subscription to all products in an agency filtered by productFamily.
 * Useful for marketplace pages that segment by ugotleads_software vs
 * myusa_education vs myusa_services, etc.
 */
export function subscribeToProductsByFamily(
  agencyId: string,
  family: ProductFamily,
  callback: (products: Product[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PRODUCTS),
    where("agencyId", "==", agencyId),
    where("productFamily", "==", family),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }))),
    (err) => onError?.(err),
  );
}

/**
 * One-shot fetch of products by owner identifier (e.g. "myusa_local").
 * Supports building admin dashboards that show which entity offers each product.
 */
export async function getProductsByOwner(
  agencyId: string,
  owner: string,
): Promise<Product[]> {
  const q = query(
    collection(getFirebaseDb(), PRODUCTS),
    where("agencyId", "==", agencyId),
    where("productOwner", "==", owner),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }));
}

/**
 * One-shot fetch of products by source label (e.g. "myusa_local", "partner_created").
 * Useful for provenance audits or source-specific filtering in the marketplace.
 */
export async function getProductsBySource(
  agencyId: string,
  source: string,
): Promise<Product[]> {
  const q = query(
    collection(getFirebaseDb(), PRODUCTS),
    where("agencyId", "==", agencyId),
    where("productSource", "==", source),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, "id">) }));
}

export function subscribeToEligibilitiesByStatus(
  agencyId: string,
  status: EligibilityStatus,
  callback: (items: ProductEligibility[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PRODUCT_ELIGIBILITY),
    where("agencyId", "==", agencyId),
    where("status", "==", status),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductEligibility, "id">) }))),
    (err) => onError?.(err),
  );
}

/**
 * Real-time subscription to ALL product_eligibility rows for an agency.
 * Used by the admin eligibility manager to show every partner/product pair.
 *
 * No composite index required — single-field equality on agencyId.
 */
export function subscribeToAgencyEligibilities(
  agencyId: string,
  callback: (items: ProductEligibility[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getFirebaseDb(), PRODUCT_ELIGIBILITY),
    where("agencyId", "==", agencyId),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductEligibility, "id">) }))),
    (err) => onError?.(err),
  );
}
