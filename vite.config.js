import { defineConfig } from "vite";
import { resolve } from "node:path";

const renderHosts = ["steptown.onrender.com", ".onrender.com"];

export default defineConfig({
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
