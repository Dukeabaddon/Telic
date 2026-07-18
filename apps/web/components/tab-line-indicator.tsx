"use client";

import type { CSSProperties } from "react";

import type { TabLineOrientation } from "@/components/use-tab-line-indicator";

export function TabLineIndicator({
  orientation,
  ready,
  style,
}: {
  readonly orientation: TabLineOrientation;
  readonly ready: boolean;
  readonly style: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`tab-line-indicator tab-line-indicator-${orientation}`}
      data-ready={ready ? "true" : "false"}
      style={style}
    />
  );
}
