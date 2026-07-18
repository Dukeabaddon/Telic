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
    const reveal = (element: HTMLElement) => {
      element.setAttribute("data-scroll-reveal-visible", "");
    };
    elements.forEach((element) => {
      element.setAttribute("data-scroll-reveal", "");
      const bounds = element.getBoundingClientRect();
      if (bounds.top < window.innerHeight * 0.92 && bounds.bottom > 0) {
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
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8%", threshold: 0.12 },
    );
    elements.forEach((element) => {
      if (!element.hasAttribute("data-scroll-reveal-visible")) {
        observer.observe(element);
      }
    });
    return () => {
      observer.disconnect();
      root.removeAttribute("data-scroll-reveal-ready");
      elements.forEach((element) => {
        element.removeAttribute("data-scroll-reveal");
        element.removeAttribute("data-scroll-reveal-visible");
      });
    };
  }, [pathname]);
  return null;
}
