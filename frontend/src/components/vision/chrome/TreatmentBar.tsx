/** Visual treatment selector. Seven CSS filter stacks, instant toggle. */
import { useT } from "@/lib/i18n";
import { TREATMENTS, type TreatmentId } from "./treatments";

export function TreatmentBar({
  active,
  onSelect,
}: {
  active: TreatmentId;
  onSelect: (id: TreatmentId) => void;
}) {
  const t = useT();
  return (
    <div
      className="pointer-events-auto flex overflow-hidden rounded-[8px] border-2 border-foreground bg-background/90 backdrop-blur"
      role="group"
      aria-label={t("Visual treatment")}
    >
      {TREATMENTS.map((tr) => (
        <button
          key={tr.id}
          onClick={() => onSelect(tr.id)}
          title={t(tr.hint)}
          aria-pressed={active === tr.id}
          className={`border-r-2 border-foreground/20 px-2.5 py-1 text-[10px] font-extrabold tracking-wide transition last:border-r-0 ${
            active === tr.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tr.label}
        </button>
      ))}
    </div>
  );
}
