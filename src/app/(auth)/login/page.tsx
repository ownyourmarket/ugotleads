import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { LogoMark } from "@/components/brand/logo-mark";
import { CUSTOM_BRAND } from "@/config/landing";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <LogoMark size={24} idSuffix="-login" />
            <h1 className="text-2xl font-bold">{CUSTOM_BRAND.name}</h1>
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            Welcome back. Sign in to your workspace.
          </p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
