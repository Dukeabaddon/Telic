"use client";

import { track } from "@vercel/analytics";
import { CheckCircle2, Info } from "lucide-react";
import { useRef, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { TabLineIndicator } from "@/components/tab-line-indicator";
import { useTabLineIndicator } from "@/components/use-tab-line-indicator";
import { installGuides } from "@/lib/site";

export function InstallTabs() {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const guide = installGuides[activeIndex];
  const indicator = useTabLineIndicator(listRef, tabRefs, activeIndex, "pill");

  function select(index: number) {
    setActiveIndex(index);
    tabRefs.current[index]?.focus();
    track("host_tab_selected", { host: installGuides[index].id });
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % installGuides.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + installGuides.length) % installGuides.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = installGuides.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    select(next);
  }

  return (
    <div className="install-tabs">
      <div
        ref={listRef}
        className="install-tablist"
        role="tablist"
        aria-label="Choose a coding host"
      >
        <TabLineIndicator
          orientation="pill"
          ready={indicator.ready}
          style={indicator.style}
        />
        {installGuides.map((item, index) => (
          <button
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`install-tab-${item.id}`}
            key={item.id}
            role="tab"
            type="button"
            aria-selected={index === activeIndex}
            aria-controls={`install-panel-${item.id}`}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <section
        className="install-panel"
        id={`install-panel-${guide.id}`}
        key={guide.id}
        role="tabpanel"
        aria-labelledby={`install-tab-${guide.id}`}
        tabIndex={0}
      >
        <div className="install-panel-header">
          <div>
            <span className="status-chip">{guide.status}</span>
            <h2>{guide.title}</h2>
            <p>{guide.description}</p>
          </div>
          <CheckCircle2 aria-hidden="true" />
        </div>
        <div className="code-block">
          <div className="code-block-bar">
            <span>Terminal / configuration</span>
            <CopyButton
              text={guide.commands}
              label={`Copy ${guide.label} setup`}
            />
          </div>
          <pre tabIndex={0}>
            <code>{guide.commands}</code>
          </pre>
        </div>
        {guide.windowsCommands ? (
          <div className="code-block">
            <div className="code-block-bar">
              <span>Windows PowerShell / configuration</span>
              <CopyButton
                text={guide.windowsCommands}
                label={`Copy ${guide.label} Windows setup`}
              />
            </div>
            <pre tabIndex={0}>
              <code>{guide.windowsCommands}</code>
            </pre>
          </div>
        ) : null}
        <div className="install-next">
          <strong>Then</strong>
          <p>{guide.next}</p>
        </div>
        {guide.technicalFallback ? (
          <div className="install-note">
            <Info aria-hidden="true" />
            <p>{guide.technicalFallback}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
