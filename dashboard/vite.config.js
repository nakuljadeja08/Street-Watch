import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset paths relative so the built dist/ works whether it's
// served from a domain root (Netlify/Vercel) or a subpath (GitHub Pages).
export default defineConfig({
  plugins: [react()],
  base: "./",
});
