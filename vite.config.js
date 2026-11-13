import { defineConfig } from "vite";

const renderHosts = ["steptown.onrender.com", ".onrender.com"];

export default defineConfig({
  // Vite preview is used by the existing Render Web Service.
  // Keep the exact production hostname and Render's subdomain suffix allowed.
  server: { allowedHosts: renderHosts },
  preview: { allowedHosts: renderHosts },
  build: { outDir: "dist", emptyOutDir: true }
});
