import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { VisionWorkspace } from "@/components/vision/VisionWorkspace";

export const Route = createFileRoute("/vision")({
  head: () => ({ meta: [{ title: "Vision \u00b7 Tactical Map \u00b7 Satyam" }] }),
  component: VisionScreen,
});

function VisionScreen() {
  // The workspace is absolutely positioned, so it needs a positioned, non-scrolling
  // parent inside Shell's <main> (which is overflow-auto by default).
  return (
    <Shell>
      <div className="relative h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        <VisionWorkspace />
      </div>
    </Shell>
  );
}
