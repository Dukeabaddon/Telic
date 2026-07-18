"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Brand } from "@/components/logo";
import { TrackedLink } from "@/components/tracked-link";
import { siteConfig } from "@/lib/site";

const navigation: readonly {
  readonly href: string;
  readonly label: string;
  readonly external: boolean;
}[] = [
  { href: "/how-it-works", label: "How it works", external: false },
  { href: "/install", label: "Install", external: false },
  { href: siteConfig.docs, label: "Docs", external: true },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Brand />
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <TrackedLink
              aria-current={item.href === pathname ? "page" : undefined}
              eventName={`nav_${item.label.toLowerCase().replaceAll(" ", "_")}`}
              href={item.href}
              key={item.href}
              {...(item.external
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              {item.label}
            </TrackedLink>
          ))}
        </nav>
        <div className="header-actions">
          <TrackedLink
            className="button button-ghost header-github"
            eventName="github_clicked"
            href={siteConfig.github}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </TrackedLink>
          <TrackedLink
            className="button button-primary header-install"
            eventName="install_cta_clicked"
            href="/install"
          >
            Install Telic
          </TrackedLink>
          <button
            ref={triggerRef}
            className="menu-trigger"
            type="button"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      {open ? (
        <div className="mobile-nav-backdrop" role="presentation">
          <div
            ref={panelRef}
            className="mobile-nav-panel"
            id="mobile-navigation"
            aria-label="Mobile navigation"
          >
            <nav>
              {navigation.map((item) => (
                <TrackedLink
                  aria-current={item.href === pathname ? "page" : undefined}
                  eventName={`nav_mobile_${item.label.toLowerCase().replaceAll(" ", "_")}`}
                  href={item.href}
                  key={item.href}
                  {...(item.external
                    ? { target: "_blank", rel: "noreferrer" }
                    : {})}
                >
                  {item.label}
                </TrackedLink>
              ))}
            </nav>
            <TrackedLink
              className="button button-primary mobile-install"
              eventName="install_cta_clicked"
              href="/install"
            >
              Install Telic
            </TrackedLink>
          </div>
        </div>
      ) : null}
    </header>
  );
}
