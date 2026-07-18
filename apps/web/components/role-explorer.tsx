"use client";

import { track } from "@vercel/analytics";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import { TabLineIndicator } from "@/components/tab-line-indicator";
import { useTabLineIndicator } from "@/components/use-tab-line-indicator";
import { roles } from "@/lib/site";

export function RoleExplorer() {
  const [activeId, setActiveId] = useState<(typeof roles)[number]["id"]>(
    roles[0].id,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const active = roles.find((role) => role.id === activeId) ?? roles[0];
  const activeIndex = Math.max(
    roles.findIndex((role) => role.id === activeId),
    0,
  );
  const indicator = useTabLineIndicator(
    listRef,
    tabsRef,
    activeIndex,
    "vertical",
  );

  function select(index: number) {
    const role = roles[index];
    setActiveId(role.id);
    tabsRef.current[index]?.focus();
    track("role_selected", { role: role.id });
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % roles.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + roles.length) % roles.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = roles.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    select(next);
  }

  return (
    <div className="role-explorer">
      <div
        ref={listRef}
        className="role-tabs"
        role="tablist"
        aria-label="Telic logical roles"
      >
        <TabLineIndicator
          orientation="vertical"
          ready={indicator.ready}
          style={indicator.style}
        />
        {roles.map((role, index) => (
          <button
            ref={(node) => {
              tabsRef.current[index] = node;
            }}
            className="role-tab"
            id={`tab-${role.id}`}
            key={role.id}
            role="tab"
            type="button"
            aria-controls={`panel-${role.id}`}
            aria-selected={active.id === role.id}
            tabIndex={active.id === role.id ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{role.number}</span>
            <strong>{role.name}</strong>
            <small>{role.verb}</small>
          </button>
        ))}
      </div>
      <div
        className="role-panel"
        id={`panel-${active.id}`}
        key={active.id}
        role="tabpanel"
        aria-labelledby={`tab-${active.id}`}
        tabIndex={0}
      >
        <div>
          <p className="role-number">Logical role {active.number}</p>
          <h3>{active.name}</h3>
          <p>{active.description}</p>
        </div>
        <dl>
          <div>
            <dt>Creates</dt>
            <dd>{active.creates}</dd>
          </div>
          <div>
            <dt>Checks</dt>
            <dd>{active.checks}</dd>
          </div>
        </dl>
      </div>
      <div className="role-accordions">
        {roles.map((role, index) => (
          <details key={role.id} open={index === 0}>
            <summary>
              <span>{role.number}</span>
              <strong>{role.name}</strong>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div>
              <p>{role.description}</p>
              <dl>
                <div>
                  <dt>Creates</dt>
                  <dd>{role.creates}</dd>
                </div>
                <div>
                  <dt>Checks</dt>
                  <dd>{role.checks}</dd>
                </div>
              </dl>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
