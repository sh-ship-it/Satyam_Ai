import type { StoredConversation } from "@/lib/conversationStore";
import { fmtTime } from "@/lib/conversationStore";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function openPrint(title: string, inner: string) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Allow pop-ups to export PDF.");
    return;
  }
  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    @page { margin: 18mm 16mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 0; color: #0f172a; }
    @media print { body { max-width: 100%; } }
  </style>
</head>
<body>
  <div style="border-bottom:3px solid #4f46e5;padding-bottom:10px;margin-bottom:20px">
    <div style="font-size:22px;font-weight:800;color:#4f46e5">Satyam — KSP Crime Intelligence</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px">
      Conversation transcript · generated ${esc(fmtTime(Date.now()))} · Synthetic data only
    </div>
  </div>
  ${inner}
  <div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:8px;font-size:10px;color:#94a3b8;text-align:center">
    CONFIDENTIAL — Karnataka State Police · Satyam Intelligence System · Datathon 2026
  </div>
</body>
</html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function exportConversationPdf(c: StoredConversation): void {
  openPrint(c.title || "Conversation", renderConvHtml(c));
}

export function exportConversationsPdf(list: StoredConversation[]): void {
  if (list.length === 0) return;
  openPrint("All conversations", list.map(renderConvHtml).join(""));
}
