import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // db/connection.ts 运行时读取 CA 证书,需打进函数包
  outputFileTracingIncludes: { "/**": ["./db/aiven-ca.pem"] },
  partialPrefetching: true,
  // 断网时软导航和 Server Action 挂起,联网后自动重试;配合 useOffline 显示离线提示
  experimental: { useOffline: true },
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
