import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · StayFlow Staff",
};

/**
 * Sign-in screen.
 *
 * `next` is read here and passed through the form so that a staff member
 * who followed a deep link to, say, a shift lands there after signing in
 * rather than on the dashboard. It is validated server-side before use.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
        Sign in
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Use the email address your manager set you up with.
      </p>

      <LoginForm next={next} />

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        <Link
          href="/forgot-password"
          className="font-medium text-teal-700 underline-offset-4 hover:underline dark:text-teal-400"
        >
          Forgotten your password?
        </Link>
      </p>

      <p className="mt-4 border-t border-slate-200 pt-4 text-center text-xs text-slate-400 dark:border-slate-800">
        Accounts are created by your manager. StayFlow Staff does not offer
        public sign-up.
      </p>
    </>
  );
}
