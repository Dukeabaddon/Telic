"use client";

import {
  type CSSProperties,
  type RefObject,
  useLayoutEffect,
  useState,
} from "react";

export type TabLineOrientation = "horizontal" | "vertical" | "pill";

export function useTabLineIndicator(
  listRef: RefObject<HTMLElement | null>,
  tabRefs: RefObject<Array<HTMLElement | null>>,
  activeIndex: number,
  orientation: TabLineOrientation = "horizontal",
): { readonly ready: boolean; readonly style: CSSProperties } {
  const [ready, setReady] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({
    width: 0,
    height: 0,
    transform: "translate3d(0, 0, 0)",
  });

  useLayoutEffect(() => {
    const list = listRef.current;

    const update = () => {
      const activeTab = tabRefs.current?.[activeIndex];
      if (!list || !activeTab) return;

      const listRect = list.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      const left = tabRect.left - listRect.left + list.scrollLeft;
      const top = tabRect.top - listRect.top + list.scrollTop;

      if (orientation === "pill") {
        setStyle({
          width: `${tabRect.width}px`,
          height: `${tabRect.height}px`,
          transform: `translate3d(${left}px, ${top}px, 0)`,
        });
        return;
      }

      if (orientation === "horizontal") {
        setStyle({
          width: `${tabRect.width}px`,
          height: "2px",
          transform: `translate3d(${left}px, 0, 0)`,
        });
        return;
      }

      setStyle({
        width: "2px",
        height: `${tabRect.height}px`,
        transform: `translate3d(0, ${top}px, 0)`,
      });
    };

    update();
    const frame = window.requestAnimationFrame(() => {
      setReady(true);
      update();
    });

    const observer = new ResizeObserver(update);
    if (list) observer.observe(list);
    tabRefs.current?.forEach((tab) => {
      if (tab) observer.observe(tab);
    });

    list?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      list?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [activeIndex, listRef, orientation, tabRefs]);

  return { ready, style };
}
