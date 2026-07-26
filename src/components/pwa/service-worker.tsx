"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Registers the service worker and surfaces an update prompt.
 *
 * Updates are never applied silently mid-shift: a staff member halfway
 * through clocking in should not have the page reload underneath them. The
 * new version installs in the background and waits until they accept.
 */
export function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // A service worker registered in development competes with hot reloading.
    if (process.env.NODE_ENV !== "production") return;

    let registration: ServiceWorkerRegistration | undefined;

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // A worker already waiting means an update arrived on a previous visit.
        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener("updatefound", () => {
          const installing = registration?.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            // "installed" with an existing controller means an update, not a
            // first install — only then is there a new version to offer.
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setWaiting(installing);
            }
          });
        });
      } catch {
        // Registration failure must never break the application; the app
        // simply runs without offline support.
      }
    };

    void register();

    // When the new worker takes control, load the fresh assets.
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-20 z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:w-80 dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        New version available
      </p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Reload to get the latest version of StayFlow Staff.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => waiting.postMessage("SKIP_WAITING")}>
          Reload now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setWaiting(null)}>
          Later
        </Button>
      </div>
    </div>
  );
}
