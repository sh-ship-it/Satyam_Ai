/**
 * Voice Screen Agent client.
 * Turns a spoken command into a navigation + in-screen action plan that the
 * Shell dispatches to the target screen via the `satyam:run-task` event.
 */
import { API_BASE, getAuthToken } from "./client";

export type ScreenAction = {
  screen: string;
  action: string;
  params: Record<string, unknown>;
};

export type AgentPlan = {
  route: string | null;
  answer: boolean; // true → pure data question, let the chat brain answer
  speak: string;
  actions: ScreenAction[];
};

export async function planVoiceAction(args: {
  command: string;
  current_route?: string | null;
  lang?: "en" | "kn";
  brain_engine?: string;
  planner?: "llm" | "rule";
}): Promise<AgentPlan> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/voice/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      command: args.command,
      current_route: args.current_route ?? null,
      lang: args.lang ?? "en",
      brain_engine: args.brain_engine,
      planner: args.planner,
    }),
  });
  if (!res.ok) throw new Error(`voice/agent failed: ${res.status}`);
  return (await res.json()) as AgentPlan;
}
