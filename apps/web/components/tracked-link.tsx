"use client";

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type TrackedLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    readonly eventName?: string;
    readonly children: ReactNode;
  };

export function TrackedLink({
  eventName: _eventName,
  children,
  ...props
}: TrackedLinkProps) {
  return <Link {...props}>{children}</Link>;
}

