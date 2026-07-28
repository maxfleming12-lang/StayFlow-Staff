import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { BottomNav, SideNav } from "@/components/layout/app-nav";
import { BrandMark } from "@/components/layout/brand-mark";
import { SignOutButton } from "@/components/layout/sign-out-button";

/**
 * Shell for every authenticated screen.
 *
 * `requireUser()` runs here, on the server, before any child renders. This
 * is the real access check — the proxy's redirect is only an optimisation,
 * and hiding navigation items is only cosmetic.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex h-16 items-center gap-3 px-4">
          <BrandMark size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              StayFlow Staff
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {user.displayName} · {ROLE_LABEL[user.role]}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <div className="flex flex-1">
        <SideNav role={user.role} />
        {/* pb-24 keeps content clear of the fixed mobile bottom bar. */}
        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-8">
          {children}
        </main>
      </div>

      <BottomNav role={user.role} />
    </div>
  );
}
