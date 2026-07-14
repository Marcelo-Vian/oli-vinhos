import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  root: resolve(__dirname, "static-site"),
  publicDir: resolve(__dirname, "public"),
  plugins: [react()],
  base: repository ? `/${repository}/` : "/",
  build: {
    outDir: resolve(__dirname, "dist-pages"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        store: resolve(__dirname, "static-site/index.html"),
        admin: resolve(__dirname, "static-site/admin/index.html"),
      },
    },
  },
});
