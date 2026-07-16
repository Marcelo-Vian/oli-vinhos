import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const usesCustomDomain = process.env.VITE_CUSTOM_DOMAIN === "true";

export default defineConfig({
  root: resolve(__dirname, "static-site"),
  publicDir: resolve(__dirname, "public"),
  plugins: [react()],
  base: usesCustomDomain ? "/" : repository ? `/${repository}/` : "/",
  build: {
    outDir: resolve(__dirname, "dist-pages"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        store: resolve(__dirname, "static-site/index.html"),
        admin: resolve(__dirname, "static-site/admin/index.html"),
        orderAction: resolve(__dirname, "static-site/pedido/acao/index.html"),
        reviewAction: resolve(__dirname, "static-site/avaliacao/acao/index.html"),
      },
    },
  },
});
