import { FlaskConical } from "lucide-react";

/**
 * Fixed "DEMO" banner shown only in the GitHub Pages build (NEXT_PUBLIC_DEMO=1)
 * so nobody mistakes the fixture data for a live system. Rendered above the
 * app; the app's own top bar sits below it.
 */
export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO !== "1") return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        DEMO — sample data, resets on reload. Not a live time clock.
      </span>
    </div>
  );
}
