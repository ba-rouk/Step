import { defineConfig } from "vite";

export default defineConfig({
  preview: {
    allowedHosts: ["steptown.onrender.com"]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
