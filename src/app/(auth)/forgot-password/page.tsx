import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password · StayFlow Staff",
};

/** Screen for requesting a password reset email. */
export default function ForgotPasswordPage() {
  return (
    <>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
        Reset your password
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        We will email you a link to set a new password.
      </p>

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm">
        <Link
          href="/login"
          className="font-medium text-teal-700 underline-offset-4 hover:underline dark:text-teal-400"
        >
          Back to sign in
        </Link>
      </p>
    </>
  );
}
