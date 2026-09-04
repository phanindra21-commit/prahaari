import type { ZoneClass } from "@punarvas/shared";

const ZONE_STYLES: Record<ZoneClass, string> = {
  Red: "bg-zone-red/20 text-zone-red border-zone-red/40",
  Orange: "bg-zone-orange/20 text-zone-orange border-zone-orange/40",
  Yellow: "bg-zone-yellow/20 text-zone-yellow border-zone-yellow/40",
  Green: "bg-zone-green/20 text-zone-green border-zone-green/40",
};

export function ZoneBadge({ zoneClass }: { zoneClass: ZoneClass }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium ${ZONE_STYLES[zoneClass]}`}
    >
      {zoneClass}
    </span>
  );
}
