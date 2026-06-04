import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    reactRouter(),
    tsconfigPaths(),
  ],
  server: {
    port: 5174,
    headers: {
      // 开发环境禁用缓存
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  },
  ssr: {
    noExternal: ["react-konva", "konva"],
  },
  optimizeDeps: {
    exclude: ["canvas"],
  },
});

