"use client";

import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toaster. Dark theme (the app is permanently dark) and top-center
 * position so toasts are never hidden behind the fixed bottom nav.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
