import { defineConfig } from "vite";

// Served at bootoshi.ai/backrooms/ as a static subfolder of the personal site.
export default defineConfig({
  base: "/backrooms/",
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
