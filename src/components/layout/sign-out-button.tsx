import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";

/**
 * Sign out control.
 *
 * A form posting to a server action rather than a client-side call, so the
 * session cookie is cleared server-side and the action still works if
 * JavaScript has not loaded.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <LogOut className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
        <span className="sr-only">Sign out</span>
      </button>
    </form>
  );
}
