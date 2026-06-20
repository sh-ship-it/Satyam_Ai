import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { LiveOperationsMap } from "@/components/ops/LiveOperationsMap";

export const Route = createFileRoute("/operations")({
  head: () => ({ meta: [{ title: "Response Ops · Satyam" }] }),
  component: OperationsScreen,
});

function OperationsScreen() {
  return (
    <Shell>
      <div className="relative flex h-full min-h-0 flex-1 flex-col">
        <div className="relative flex-1">
          <LiveOperationsMap />
        </div>
      </div>
    </Shell>
  );
}
