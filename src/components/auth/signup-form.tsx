"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signInWithEmail } from "@/lib/firebase/auth";
import { sendWelcomeEmail } from "@/lib/firestore/mail";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Pre-fill email when arriving from an invite link (/signup?email=…). The
  // signup API still re-validates against the invite doc by email, so this is
  // pure UX convenience.
  const initialEmail = searchParams?.get("email") ?? "";
  // When arriving from the Stripe Checkout success URL we get
  // ?session=cs_... — passed to the signup API so the server-side gate
  // knows to mint a brand-new agency for the self-serve buyer.
  const stripeSessionId = searchParams?.get("session") ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!agreedToTerms) {
      setError("You must agree to the Terms of Service and Privacy Policy.");
      return;
    }

    setLoading(true);

    try {
      // Server-side gate: enforces "first signup = admin, others must be invited"
      // and creates the Firebase Auth user + user doc + custom claims.
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          stripeSessionId: stripeSessionId || undefined,
          displayName: email.split("@")[0],
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirectTo?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "Could not create account.");
      }

      // Sign in client-side to mint the Firebase ID token, then exchange it
      // for the __session cookie middleware reads.
      await signInWithEmail(email, password);

      void sendWelcomeEmail(email, email.split("@")[0]).catch((err) =>
        console.warn("sendWelcomeEmail failed", err),
      );

      router.push(payload.redirectTo ?? "/dashboard");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create account.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Account</CardTitle>
        <CardDescription>
          Enter your details to create a new account.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex items-start space-x-2">
            <Checkbox
              id="terms"
              checked={agreedToTerms}
              onCheckedChange={(checked) =>
                setAgreedToTerms(checked === true)
              }
            />
            <Label htmlFor="terms" className="text-sm leading-snug">
              I agree to the{" "}
              <Link href="/terms" className="text-primary underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-primary underline">
                Privacy Policy
              </Link>
            </Label>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-primary underline">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
