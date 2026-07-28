import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password · StayFlow Staff",
};

/**
 * Set a new password.
 *
 * Reached only by following the emailed recovery link, which passes through
 * /auth/callback to establish a session first. Landing here without one
 * means the link has expired or was opened out of context, so we say so
 * plainly instead of showing a form that cannot work.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Link expired
        </h2>
        <div className="mt-4">
          <Alert tone="warning">
            This password reset link is no longer valid. Reset links can only
            be used once, and expire after a short time.
          </Alert>
        </div>
        <p className="mt-6 text-center text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-teal-700 underline-offset-4 hover:underline dark:text-teal-400"
          >
            Request a new link
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
        Choose a new password
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Setting a password for {user.email}.
      </p>
      <ResetPasswordForm />
    </>
  );
}
