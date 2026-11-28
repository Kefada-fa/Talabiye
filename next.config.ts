import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // DEVELOPMENT ONLY: lets a phone on the same home Wi-Fi open the dev
  // server (http://192.168.x.x:3000) with all its scripts. Without it,
  // Next.js blocks them and buttons like "More" do nothing.
  // Has no effect on the real (production) website.
  allowedDevOrigins: ["192.168.*.*"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
