import type { StoredConversation } from "@/lib/conversationStore";
import { fmtTime } from "@/lib/conversationStore";
import { esc, openPrint } from "@/lib/pdf/printView";

function renderConvHtml(c: StoredConversation): string {
  const rows = c.messages
    .map((m) => {
      const who = m.role === "user" ? c.officer || "Officer" : "Satyam AI";
      const bg = m.role === "user" ? "#eef2ff" : "#f1f5f9";
      const border = m.role === "user" ? "#c7d2fe" : "#e2e8f0";
      return `<div style="margin:8px 0;padding:10px 14px;border-radius:8px;background:${bg};border-left:3px solid ${border}">
      <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">${esc(who)}</div>
      <div style="font-size:13px;color:#0f172a;white-space:pre-wrap;line-height:1.5">${esc(m.text)}</div>
      ${
        (m.citations?.length ?? 0) > 0
          ? `<div style="margin-top:6px;font-size:10px;color:#64748b">
        ${m.citations!.map((c) => `<span style="margin-right:8px;background:#e2e8f0;padding:1px 6px;border-radius:4px">${esc(String(c))}</span>`).join("")}
      </div>`
          : ""
      }
    </div>`;
    })
    .join("");

  return `<section style="page-break-after:always;margin-bottom:24px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-bottom:12px">
      <h2 style="font-size:15px;font-weight:800;color:#1e293b;margin:0">${esc(c.title || "Conversation")}</h2>
      <div style="font-size:10px;color:#64748b;text-align:right">
        ${c.officer ? `<div>${esc(c.officer)}</div>` : ""}
        <div>${esc(fmtTime(c.createdAt))}</div>
      </div>
    </div>
    <div style="font-size:12px;color:#475569;margin-bottom:10px">
      ${c.messages.length} message${c.messages.length !== 1 ? "s" : ""}
    </div>
    ${rows}
  </section>`;
}

export function exportConversationPdf(c: StoredConversation): void {
  openPrint(c.title || "Conversation", renderConvHtml(c));
}

export function exportConversationsPdf(list: StoredConversation[]): void {
  if (list.length === 0) return;
  openPrint("All conversations", list.map(renderConvHtml).join(""));
}
