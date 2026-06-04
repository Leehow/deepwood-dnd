import type { Config } from "@react-router/dev/config";

export default {
  basename: process.env.VITE_BASE_PATH || '/',
} satisfies Config;
