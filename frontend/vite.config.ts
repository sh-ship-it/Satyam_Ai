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
  },
  ssr: {
    noExternal: true,
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
