import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Served at /manifest.webmanifest by Next's metadata route handler, so the
 * icon paths and theme colours stay in TypeScript alongside the rest of the
 * application rather than drifting in a hand-maintained JSON file.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StayFlow Staff",
    short_name: "StayFlow",
    description:
      "Rosters, timesheets, time clock and team updates for motel staff.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#0f766e",
    background_color: "#f8fafc",
    lang: "en-AU",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Maskable icons let Android crop to its adaptive icon shape without
      // clipping the mark.
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
