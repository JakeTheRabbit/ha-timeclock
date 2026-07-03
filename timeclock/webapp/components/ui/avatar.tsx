"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { initials, tintFor } from "@/lib/avatar";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-lg",
} as const;

export interface AvatarProps {
  /** Employee id — used to fetch GET /api/avatars/:id (HA profile picture). */
  employeeId: string;
  /** Display name — drives the initials fallback + accessible label. */
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * Employee avatar: the Home Assistant profile picture (proxied via
 * /api/avatars/:id) with a graceful initials fallback whenever there is no
 * picture or the fetch fails. In the static demo there is no avatar backend, so
 * it renders initials directly (no failing request).
 */
export function Avatar({ employeeId, name, size = "md", className }: AvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const src = DEMO ? null : `${BASE}/api/avatars/${employeeId}`;
  const showImg = !!src && !failed;

  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      style={showImg ? undefined : { backgroundColor: tintFor(name) }}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none",
        SIZES[size],
        className,
      )}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
