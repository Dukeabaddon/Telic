"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const REVEAL_SELECTOR = "main > header, main > section, .site-footer > .shell";
/** Shared trigger line: appear when scrolling down past it, disappear when scrolling up past it. */
const TRIGGER_RATIO = 0.78;

export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR),
    ).filter((element) => !element.hasAttribute("data-scroll-reveal-static"));
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let lastScrollY = window.scrollY;
    let scrollDirection: "down" | "up" = "down";
    let frame = 0;

    const syncDirection = () => {
      const currentY = window.scrollY;
      if (Math.abs(currentY - lastScrollY) < 1) return;
      scrollDirection = currentY > lastScrollY ? "down" : "up";
      lastScrollY = currentY;
    };

    const reveal = (element: HTMLElement) => {
      element.setAttribute("data-scroll-reveal", "down");
      element.setAttribute("data-scroll-reveal-visible", "");
    };

    const hide = (element: HTMLElement) => {
      element.setAttribute("data-scroll-reveal", "down");
      element.removeAttribute("data-scroll-reveal-visible");
    };

    const update = () => {
      syncDirection();
      const triggerY = window.innerHeight * TRIGGER_RATIO;

      elements.forEach((element) => {
        const top = element.getBoundingClientRect().top;
        const pastTrigger = top < triggerY;
        const isVisible = element.hasAttribute("data-scroll-reveal-visible");

        if (scrollDirection === "down") {
          // Section-by-section appear as each crosses into view.
          if (pastTrigger && !isVisible) {
            reveal(element);
          }
          return;
        }

        // Section-by-section disappear as each crosses back out while scrolling up.
        if (!pastTrigger && isVisible) {
          hide(element);
        }
      });
    };

    const onScrollOrResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    elements.forEach((element) => {
      element.setAttribute("data-scroll-reveal", "down");
    });
    root.setAttribute("data-scroll-reveal-ready", "");

    if (reducedMotion) {
      elements.forEach(reveal);
      return () => {
        root.removeAttribute("data-scroll-reveal-ready");
        elements.forEach((element) => {
          element.removeAttribute("data-scroll-reveal");
          element.removeAttribute("data-scroll-reveal-visible");
        });
      };
    }

    // Initial paint: show only sections already past the trigger.
    update();

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      root.removeAttribute("data-scroll-reveal-ready");
      elements.forEach((element) => {
        element.removeAttribute("data-scroll-reveal");
        element.removeAttribute("data-scroll-reveal-visible");
      });
    };
  }, [pathname]);

  return null;
}
