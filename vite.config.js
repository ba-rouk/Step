import { defineConfig } from "vite";
import { resolve } from "node:path";
import { CAKE_CATEGORY_LABEL } from "./src/catalog-config.js";

const renderHosts = ["vitanova.onrender.com", ".onrender.com"];

export default defineConfig({
  plugins: [{
    name: "vitanova-category-label",
    transformIndexHtml(html) {
      return html.replaceAll("__CAKE_CATEGORY_LABEL__", CAKE_CATEGORY_LABEL);
    }
  }],
  // Vite preview is used by the existing Render Web Service.
  // Keep the exact production hostname and Render's subdomain suffix allowed.
  server: { allowedHosts: renderHosts },
  preview: { allowedHosts: renderHosts },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Build staff as an independent entry so /staff/* does not depend on
    // storefront JavaScript or its page initialization.
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        staff: resolve(process.cwd(), "staff.html")
      }
    }
  }
});
