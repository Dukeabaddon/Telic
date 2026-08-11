"use client";

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type TrackedLinkProps = Omit<
  LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">,
  "eventName"
> & {
  readonly eventName?: string;
  readonly children: ReactNode;
};

export function TrackedLink({
  eventName,
  children,
  ...props
}: TrackedLinkProps) {
  void eventName;
  return <Link {...props}>{children}</Link>;
}
