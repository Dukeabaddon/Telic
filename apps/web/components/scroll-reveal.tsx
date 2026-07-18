"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const REVEAL_SELECTOR = "main > header, main > section, .site-footer > .shell";

export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR),
    );
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let lastScrollY = window.scrollY;
    let scrollDirection: "down" | "up" = "down";

    const syncDirection = () => {
      const currentY = window.scrollY;
      if (Math.abs(currentY - lastScrollY) < 2) return;
      scrollDirection = currentY > lastScrollY ? "down" : "up";
      lastScrollY = currentY;
    };

    const reveal = (element: HTMLElement) => {
      element.setAttribute("data-scroll-reveal-visible", "");
    };

    const hide = (element: HTMLElement) => {
      element.removeAttribute("data-scroll-reveal-visible");
    };

    elements.forEach((element) => {
      const bounds = element.getBoundingClientRect();
      const inView =
        bounds.top < window.innerHeight * 0.88 && bounds.bottom > 48;
      element.setAttribute("data-scroll-reveal", "down");
      if (inView) {
        reveal(element);
      }
    });

    root.setAttribute("data-scroll-reveal-ready", "");

    if (reducedMotion || !("IntersectionObserver" in window)) {
      elements.forEach(reveal);
      return () => {
        root.removeAttribute("data-scroll-reveal-ready");
        elements.forEach((element) => {
          element.removeAttribute("data-scroll-reveal");
          element.removeAttribute("data-scroll-reveal-visible");
        });
      };
    }

    window.addEventListener("scroll", syncDirection, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        syncDirection();
        entries.forEach((entry) => {
          const element = entry.target as HTMLElement;
          const isVisible = element.hasAttribute("data-scroll-reveal-visible");

          if (entry.isIntersecting && entry.intersectionRatio >= 0.18) {
            if (isVisible) return;
            element.setAttribute("data-scroll-reveal", scrollDirection);
            // Apply the entry offset before fading in so the motion is visible.
            void element.getBoundingClientRect();
            requestAnimationFrame(() => reveal(element));
            return;
          }

          if (!entry.isIntersecting && isVisible) {
            hide(element);
          }
        });
      },
      {
        rootMargin: "-6% 0px -10% 0px",
        threshold: [0, 0.18, 0.35],
      },
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", syncDirection);
      root.removeAttribute("data-scroll-reveal-ready");
      elements.forEach((element) => {
        element.removeAttribute("data-scroll-reveal");
        element.removeAttribute("data-scroll-reveal-visible");
      });
    };
  }, [pathname]);

  return null;
}
