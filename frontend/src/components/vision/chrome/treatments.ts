/** Treatment registry. Ids match the `.vx-<id>` classes in treatments.css. */

export type TreatmentId =
  | "standard"
  | "crt"
  | "nvg"
  | "flir"
  | "radar"
  | "satcom"
  | "noir";

export type Treatment = {
  id: TreatmentId;
  /** Short label for the bar. Kept to <= 6 chars so seven fit without wrapping. */
  label: string;
  /** Tooltip. Says plainly what the treatment is and is not. */
  hint: string;
};

export const TREATMENTS: Treatment[] = [
  { id: "standard", label: "STD", hint: "Standard \u2014 no colour transform" },
  { id: "crt", label: "CRT", hint: "CRT \u2014 scanlines and tube vignette" },
  {
    id: "nvg",
    label: "NVG",
    hint: "Night vision \u2014 green phosphor look. A display filter, not a real intensifier.",
  },
  {
    id: "flir",
    label: "FLIR",
    hint: "FLIR-style pseudocolour. Approximate colour ramp, NOT radiometric temperature data.",
  },
  { id: "radar", label: "RADAR", hint: "Radar \u2014 rotating phosphor sweep" },
  { id: "satcom", label: "SATCOM", hint: "Satcom \u2014 low-bandwidth downlink look" },
  { id: "noir", label: "NOIR", hint: "Noir \u2014 high-contrast monochrome" },
];

export const TREATMENT_STORAGE_KEY = "fq-vision-treatment";

export function treatmentClass(id: TreatmentId): string {
  return `vx vx-${id}`;
}
