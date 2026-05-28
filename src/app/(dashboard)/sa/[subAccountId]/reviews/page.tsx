"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  getDocs,
  where,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

interface ReviewDoc {
  id: string;
  platform: string;
  authorName: string | null;
  rating: number | null;
  text: string | null;
  url: string | null;
  publishedAt: string | null;
  createdAt?: { seconds: number };
}

interface ReviewRequestDoc {
  id: string;
  contactName: string;
  channel: string;
  reviewUrl: string;
  results: { email?: string; sms?: string };
  createdAt: { seconds: number };
}

interface ContactSlim {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

const PLATFORM_EMOJI: Record<string, string> = {
  google: "🌐",
  yelp: "⭐",
  facebook: "📘",
  tripadvisor: "🦉",
  unknown: "💬",
};

export default function ReviewsPage() {
  const { subAccountId } = useParams<{ subAccountId: string }>();
  const [reviews, setReviews] = useState<ReviewDoc[]>([]);
  const [requests, setRequests] = useState<ReviewRequestDoc[]>([]);

  // Send review request state
  const [sendOpen, setSendOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactSlim[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [channel, setChannel] = useState<"email" | "sms" | "both">("both");
  const [reviewUrl, setReviewUrl] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [contactSearch, setContactSearch] = useState("");

  // Load reviews (from Zernio webhook mirror)
  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(
      collection(db, `subAccounts/${subAccountId}/reviews`),
      orderBy("createdAt", "desc"),
      limit(50),
    );
    return onSnapshot(q, (snap) => {
      setReviews(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReviewDoc)),
      );
    });
  }, [subAccountId]);

  // Load sent review requests
  useEffect(() => {
    const db = getFirebaseDb();
    const q = query(
      collection(db, `subAccounts/${subAccountId}/reviewRequests`),
      orderBy("createdAt", "desc"),
      limit(50),
    );
    return onSnapshot(q, (snap) => {
      setRequests(
        snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as ReviewRequestDoc),
        ),
      );
    });
  }, [subAccountId]);

  // Load contacts for the request form
  useEffect(() => {
    async function load() {
      const db = getFirebaseDb();
      const q = query(
        collection(db, "contacts"),
        where("subAccountId", "==", subAccountId),
        orderBy("createdAt", "desc"),
        limit(200),
      );
      const snap = await getDocs(q);
      setContacts(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ContactSlim)),
      );
    }
    void load();
  }, [subAccountId]);

  async function sendRequest() {
    if (!selectedContactId || !reviewUrl.trim()) {
      toast.error("Pick a contact and enter your review URL.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(
        `/api/sub-accounts/${subAccountId}/reviews/request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: selectedContactId,
            channel,
            reviewUrl: reviewUrl.trim(),
            customMessage: customMessage.trim() || undefined,
          }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        results?: { email?: string; sms?: string };
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const sent = Object.entries(data.results ?? {})
        .filter(([, v]) => v === "sent")
        .map(([k]) => k);
      toast.success(
        sent.length > 0
          ? `Review request sent via ${sent.join(" & ")}.`
          : "Request recorded but channels were skipped (missing email/phone).",
      );
      setSelectedContactId("");
      setCustomMessage("");
      setSendOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  // Average rating
  const rated = reviews.filter((r) => r.rating != null);
  const avgRating =
    rated.length > 0
      ? (rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(
          1,
        )
      : null;

  const filteredContacts = contactSearch.trim()
    ? contacts.filter((c) => {
        const name =
          `${c.firstName ?? ""} ${c.lastName ?? ""} ${c.name ?? ""} ${c.email ?? ""}`.toLowerCase();
        return name.includes(contactSearch.toLowerCase());
      })
    : contacts;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reviews</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor incoming reviews and send review requests to your
            customers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSendOpen(!sendOpen)}
          className="shrink-0 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
        >
          {sendOpen ? "Cancel" : "Request a review"}
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-2xl font-bold">{reviews.length}</div>
          <div className="text-xs text-muted-foreground">Reviews received</div>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-2xl font-bold">{avgRating ?? "—"}</div>
          <div className="text-xs text-muted-foreground">Average rating</div>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="text-2xl font-bold">{requests.length}</div>
          <div className="text-xs text-muted-foreground">Requests sent</div>
        </div>
      </div>

      {/* Send review request form */}
      {sendOpen && (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Send review request</h2>

          <div>
            <label
              htmlFor="review-url"
              className="block text-sm font-medium mb-1"
            >
              Review URL <span className="text-red-500">*</span>
            </label>
            <input
              id="review-url"
              type="url"
              placeholder="https://g.page/r/YOUR-GOOGLE-REVIEW-LINK"
              value={reviewUrl}
              onChange={(e) => setReviewUrl(e.target.value)}
              className="w-full h-10 px-3 rounded-md border bg-background text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Paste your Google review link, Yelp page, or any review URL you
              want to send customers to.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Contact <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Search contacts…"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              className="w-full h-10 px-3 rounded-md border bg-background text-sm mb-2"
            />
            <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
              {filteredContacts.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  No contacts found.
                </div>
              ) : (
                filteredContacts.slice(0, 30).map((c) => {
                  const display =
                    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
                    c.name ||
                    c.email ||
                    "Unnamed";
                  const isSelected = selectedContactId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedContactId(c.id)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition ${
                        isSelected ? "bg-primary/10 font-medium" : ""
                      }`}
                    >
                      <div>{display}</div>
                      <div className="text-xs text-muted-foreground">
                        {[c.email, c.phone].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="review-channel"
                className="block text-sm font-medium mb-1"
              >
                Send via
              </label>
              <select
                id="review-channel"
                value={channel}
                onChange={(e) =>
                  setChannel(e.target.value as "email" | "sms" | "both")
                }
                className="w-full h-10 px-3 rounded-md border bg-background text-sm"
              >
                <option value="both">Email + SMS</option>
                <option value="email">Email only</option>
                <option value="sms">SMS only</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="custom-msg"
              className="block text-sm font-medium mb-1"
            >
              Personal note (optional)
            </label>
            <textarea
              id="custom-msg"
              placeholder="Thanks for choosing us! We hope you had a great experience."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              maxLength={500}
            />
          </div>

          <button
            type="button"
            onClick={sendRequest}
            disabled={sending || !selectedContactId || !reviewUrl.trim()}
            className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send review request"}
          </button>
        </div>
      )}

      {/* Incoming reviews */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Incoming reviews</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reviews yet. Reviews from connected social platforms appear here
            automatically via Zernio webhooks. You can also send review requests
            to your customers.
          </p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        )}
      </div>

      {/* Sent requests */}
      {requests.length > 0 && (
        <div className="rounded-xl border bg-card p-6 space-y-3">
          <h2 className="text-lg font-semibold">Sent requests</h2>
          <div className="space-y-2">
            {requests.map((req) => (
              <div
                key={req.id}
                className="rounded-md border p-3 text-sm flex items-center justify-between"
              >
                <div>
                  <span className="font-medium">{req.contactName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    via {req.channel}
                  </span>
                  {req.results?.email && (
                    <span
                      className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        req.results.email === "sent"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                    >
                      email: {req.results.email}
                    </span>
                  )}
                  {req.results?.sms && (
                    <span
                      className={`ml-1 text-xs px-1.5 py-0.5 rounded ${
                        req.results.sms === "sent"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                    >
                      sms: {req.results.sms}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {req.createdAt
                    ? new Date(
                        req.createdAt.seconds * 1000,
                      ).toLocaleDateString()
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewDoc }) {
  const emoji = PLATFORM_EMOJI[review.platform] ?? PLATFORM_EMOJI.unknown;
  const stars = review.rating != null ? "★".repeat(review.rating) + "☆".repeat(Math.max(0, 5 - review.rating)) : null;

  return (
    <div className="rounded-md border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            {emoji}
          </span>
          <span className="font-medium text-sm">
            {review.authorName ?? "Anonymous"}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {review.platform}
          </span>
        </div>
        {stars && (
          <span className="text-amber-500 text-sm tracking-wider">
            {stars}
          </span>
        )}
      </div>
      {review.text && (
        <p className="text-sm whitespace-pre-wrap">{review.text}</p>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {review.publishedAt
            ? new Date(review.publishedAt).toLocaleDateString()
            : review.createdAt
              ? new Date(review.createdAt.seconds * 1000).toLocaleDateString()
              : ""}
        </span>
        {review.url && (
          <a
            href={review.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            View on {review.platform}
          </a>
        )}
      </div>
    </div>
  );
}
