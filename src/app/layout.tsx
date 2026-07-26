import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerManager } from "@/components/pwa/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StayFlow Staff",
    template: "%s",
  },
  description:
    "Rosters, timesheets, time clock and team updates for motel staff.",
  applicationName: "StayFlow Staff",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "StayFlow",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: {
    // Stops iOS turning shift times and room numbers into phone links.
    telephone: false,
    date: false,
  },
  // Staff data must never be indexed, even if a route were somehow exposed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f766e" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  width: "device-width",
  initialScale: 1,
  // `viewportFit: cover` lets the layout use the full screen on notched
  // iPhones; safe-area insets in the navigation keep content clear.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU" className="h-full">
      <body className="min-h-dvh bg-slate-50 antialiased dark:bg-slate-950">
        {children}
        <ServiceWorkerManager />
      </body>
    </html>
  );
}
