/** Bộ icon nét (stroke) 24px, không phụ thuộc thư viện ngoài. Dữ liệu path nằm ở icon-paths.ts. */
import { ICON_PATHS, type IconName } from "./icon-paths";

export { ICON_NAMES, LINK_ICONS, LINK_COLORS, LINK_COLOR_NAMES, type IconName, type LinkColor } from "./icon-paths";

export function Icon({ name, className = "size-5", strokeWidth = 1.8 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
