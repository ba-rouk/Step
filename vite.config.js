import { defineConfig } from "vite";
import { resolve } from "node:path";
import { CAKE_CATEGORY } from "./src/category-config.js";

const renderHosts = ["steptown.onrender.com", ".onrender.com"];

export default defineConfig({
  plugins: [{
    name: "step-town-category-copy",
    transformIndexHtml(html) {
      return html.replaceAll("__CAKE_CATEGORY__", CAKE_CATEGORY.label);
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
