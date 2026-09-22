import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: "100mb" },
};

export default config;
