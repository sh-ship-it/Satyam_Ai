import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useState } from "react";
import { Users, AlertTriangle } from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import {
  intelligence,
  type SocioDemographicsResponse,
  type SocioCorrelationResponse,
  type SocialRiskIndexResponse,
} from "@/lib/api/intelligence";

export const Route = createFileRoute("/socio")({
  head: () => ({ meta: [{ title: "Socio Dashboard · Satyam" }] }),
  component: SocioDashboard,
});

function SocioDashboard() {
  const t = useT();
  const { lang } = useI18n();
  const [demo, setDemo] = useState<SocioDemographicsResponse | null>(null);
  const [corr, setCorr] = useState<SocioCorrelationResponse | null>(null);
  const [risk, setRisk] = useState<SocialRiskIndexResponse | null>(null);
  const [role, setRole] = useState<"Accused" | "Victim">("Accused");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ role });
    Promise.all([
      intelligence.getSocioDemographics(p),
      intelligence.getSocioCorrelation(),
      intelligence.getSocialRiskIndex(),
    ])
      .then(([d, c, r]) => {
        setDemo(d);
        setCorr(c);
        setRisk(r);
        setError(null);
      })
      .catch((e) =>
        setError(
          e?.status === 403 ? "SP+ rank required to view this data." : "Could not load socio data.",
        ),
      )
      .finally(() => setLoading(false));
  }, [role]);

  return (
    <Shell>
      <div className="flex flex-col h-full overflow-auto">
        <div className="border-b-2 border-foreground bg-header px-6 py-4 text-header-foreground">
          <div className="text-[11px] uppercase tracking-wider opacity-60">PS4 · SP+ access</div>
          <h1 className="text-xl font-extrabold tracking-tight">Socio-Economic Dashboard</h1>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {loading && <div className="text-muted-foreground text-sm">Loading…</div>}
          {error && (
            <div className="rounded-[5px] border-2 border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {demo && (
            <>
              {/* Notice */}
              <div className="flex items-start gap-2 rounded-[5px] border-2 border-foreground bg-primary/5 p-3">
                <AlertTriangle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs">{demo.notice}</p>
              </div>

              {/* Role toggle */}
              <div className="flex gap-2">
                {(["Accused", "Victim"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={`rounded-[5px] border-2 border-foreground px-4 py-1.5 text-xs font-bold transition ${role === r ? "bg-primary text-primary-foreground nb-shadow-sm" : "bg-secondary-background"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Age + Gender side by side */}
              <div className="grid md:grid-cols-2 gap-4">
                <ChartCard title="Age Distribution" icon={<Users className="h-4 w-4" />}>
                  {demo.age_buckets.map((b) => {
                    const max = Math.max(...demo.age_buckets.map((x) => x.count));
                    return (
                      <div key={b.bucket} className="flex items-center gap-2 mb-1">
                        <span className="w-16 text-xs text-muted-foreground">{b.bucket}</span>
                        <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden border border-border">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${(b.count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums">{b.count}</span>
                      </div>
                    );
                  })}
                </ChartCard>
                <ChartCard title="Gender Distribution" icon={<Users className="h-4 w-4" />}>
                  {demo.gender.map((g) => {
                    const total = demo.gender.reduce((s, x) => s + x.count, 0);
                    return (
                      <div key={g.gender} className="flex items-center gap-2 mb-1">
                        <span className="w-16 text-xs text-muted-foreground">
                          {tData("gender", g.gender, lang)}
                        </span>
                        <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden border border-border">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${(g.count / total) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums">
                          {Math.round((g.count / total) * 100)}%
                        </span>
                      </div>
                    );
                  })}
                </ChartCard>
              </div>
            </>
          )}

          {/* Correlation table */}
          {corr && (
            <section>
              <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide">
                Correlation Matrix
              </h2>
              <p className="mb-3 text-xs text-muted-foreground italic">{corr.notice}</p>
              <div className="overflow-hidden rounded-[5px] border-2 border-foreground nb-shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      {["District", "Crime Rate", "Literacy %", "Urban %", "Income Index"].map(
                        (h) => (
                          <th key={h} className="px-3 py-2.5 text-left font-medium">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {corr.scatter.slice(0, 10).map((r) => (
                      <tr key={r.district} className="hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">
                          {tData("district", r.district, lang)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{r.crime_rate.toFixed(1)}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.literacy_rate?.toFixed(1) ?? "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.urbanization_percent?.toFixed(1) ?? "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.income_index?.toFixed(2) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Risk index */}
          {risk && (
            <section>
              <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide">
                Social Risk Index
              </h2>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {risk.areas.map((a) => (
                  <div
                    key={a.district}
                    className="rounded-[5px] border-2 border-foreground bg-card p-3 nb-shadow-sm"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold">
                        {tData("district", a.district, lang)}
                      </span>
                      <span
                        className={`text-sm font-extrabold tabular-nums ${a.social_risk_score >= 70 ? "text-destructive" : a.social_risk_score >= 40 ? "text-orange-500" : "text-success"}`}
                      >
                        {a.social_risk_score}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {a.drivers.map((d) => (
                        <span
                          key={d}
                          className="rounded-[3px] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[5px] border-2 border-foreground bg-card p-4 nb-shadow-sm">
      <div className="flex items-center gap-2 mb-3 text-sm font-bold">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
