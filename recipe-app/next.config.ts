import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["unrallying-impracticably-shay.ngrok-free.dev"],
  output: "export",
  trailingSlash: true,
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
