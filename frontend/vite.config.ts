import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// Standard TanStack Start (Vite) config for the Satyam frontend.
// No third-party build wrapper: we wire the official plugins directly.
// `src/start.ts` is auto-detected by TanStack Start for middleware,
// and `src/server.ts` is our SSR error-wrapping server entry.
export default defineConfig({
  server: {
    port: Number(process.env.PORT ?? 3000),
    host: true,
    // Vite's dev server rejects unrecognized Host headers by default (CVE-2025
    // DNS-rebinding protection). A cloudflared quick tunnel proxies through a
    // random *.trycloudflare.com hostname, which trips that check with a 403.
    // TEMP for the demo tunnel — remove once it's torn down.
    allowedHosts: [".trycloudflare.com"],
  },
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      server: {
        entry: "./src/server.ts",
      },
    }),
    viteReact(),
  ],
});
