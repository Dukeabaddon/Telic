"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const REVEAL_SELECTOR = "main > header, main > section, .site-footer > .shell";

function isEnoughInView(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  const viewHeight = window.innerHeight;
  return bounds.top < viewHeight * 0.82 && bounds.bottom > viewHeight * 0.12;
}

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
      if (Math.abs(currentY - lastScrollY) < 1) return;
      scrollDirection = currentY > lastScrollY ? "down" : "up";
      lastScrollY = currentY;
    };

    const reveal = (element: HTMLElement) => {
      element.setAttribute("data-scroll-reveal", "down");
      element.setAttribute("data-scroll-reveal-visible", "");
    };

    const hide = (element: HTMLElement) => {
      // Keep entry direction as "down" so the next scroll-down appear stays smooth.
      element.setAttribute("data-scroll-reveal", "down");
      element.removeAttribute("data-scroll-reveal-visible");
    };

    elements.forEach((element) => {
      element.setAttribute("data-scroll-reveal", "down");
      if (isEnoughInView(element)) {
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

    const revealVisibleWhileScrollingDown = () => {
      if (scrollDirection !== "down") return;
      elements.forEach((element) => {
        if (
          !element.hasAttribute("data-scroll-reveal-visible") &&
          isEnoughInView(element)
        ) {
          // Ensure the hidden offset paints before fading in.
          void element.getBoundingClientRect();
          requestAnimationFrame(() => reveal(element));
        }
      });
    };

    const hideLeavingElements = () => {
      elements.forEach((element) => {
        if (!element.hasAttribute("data-scroll-reveal-visible")) return;
        if (!isEnoughInView(element)) {
          hide(element);
        }
      });
    };

    const onScroll = () => {
      syncDirection();
      if (scrollDirection === "up") {
        // While scrolling up, hide sections that leave the reading window so
        // the next scroll-down can play the appear animation again.
        hideLeavingElements();
        return;
      }
      revealVisibleWhileScrollingDown();
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        syncDirection();
        entries.forEach((entry) => {
          const element = entry.target as HTMLElement;
          const isVisible = element.hasAttribute("data-scroll-reveal-visible");

          if (!entry.isIntersecting) {
            if (isVisible) hide(element);
            return;
          }

          // Appear only while scrolling down. Scrolling up must not re-show
          // sections that re-enter from the top.
          if (
            scrollDirection === "down" &&
            entry.intersectionRatio >= 0.16 &&
            !isVisible &&
            isEnoughInView(element)
          ) {
            void element.getBoundingClientRect();
            requestAnimationFrame(() => reveal(element));
          }
        });
      },
      {
        rootMargin: "0px 0px -8% 0px",
        threshold: [0, 0.08, 0.16, 0.28, 0.45],
      },
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      root.removeAttribute("data-scroll-reveal-ready");
      elements.forEach((element) => {
        element.removeAttribute("data-scroll-reveal");
        element.removeAttribute("data-scroll-reveal-visible");
      });
    };
  }, [pathname]);

  return null;
}
