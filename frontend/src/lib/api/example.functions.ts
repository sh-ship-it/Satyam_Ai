import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getServerConfig } from "../config.server";

// Example TanStack Start server function (SSR-only handler invoked from the
// client). The `.handler` body runs server-side only; imports used inside it
// (like `.server.ts` modules) are tree-shaken from the client bundle.
//
// In Satyam, prefer calling the FastAPI backend through `src/lib/api/client.ts`.
// Use server functions only for SSR-time work (e.g. reading server config).

export const getRuntimeInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({}).optional())
  .handler(async () => {
    const config = getServerConfig();
    return {
      app: "satyam-frontend",
      mode: config.nodeEnv ?? "unknown",
      apiBase: process.env.VITE_API_BASE_URL ?? "http://localhost:8000",
    };
  });
