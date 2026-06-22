import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { Video } from "lucide-react";
import { useT } from "@/lib/i18n";
import { ReviewPanel } from "@/components/ops/ReviewPanel";

export const Route = createFileRoute("/ops-camera")({
  head: () => ({ meta: [{ title: "Camera Review · Satyam" }] }),
  component: CameraScreen,
});

function CameraScreen() {
  const t = useT();
  return (
    <Shell>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-foreground bg-[var(--main)] text-foreground">
            <Video className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-none">{t("Camera Review")}</h1>
            <p className="text-xs text-muted-foreground">
              {t("AI detection · human confirmation · incident filing")}
            </p>
          </div>
        </header>
        <ReviewPanel />
      </div>
    </Shell>
  );
}
