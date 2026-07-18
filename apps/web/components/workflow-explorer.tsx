"use client";

import { track } from "@vercel/analytics";
import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";

import { workflowStages } from "@/lib/site";

export function WorkflowExplorer() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = workflowStages[activeIndex];
  const ActiveIcon = active.icon;

  function select(index: number) {
    setActiveIndex(index);
    tabRefs.current[index]?.focus();
    track("workflow_stage_selected", { stage: workflowStages[index].id });
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % workflowStages.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + workflowStages.length) % workflowStages.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = workflowStages.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    select(next);
  }

  return (
    <div className="workflow-explorer">
      <div
        className="workflow-tabs"
        role="tablist"
        aria-label="Telic workflow stages"
      >
        {workflowStages.map((stage, index) => (
          <button
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            className="workflow-tab"
            id={`workflow-tab-${stage.id}`}
            key={stage.id}
            role="tab"
            type="button"
            aria-controls={`workflow-panel-${stage.id}`}
            aria-selected={index === activeIndex}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {stage.shortLabel}
          </button>
        ))}
      </div>
      <div
        className="workflow-panel"
        id={`workflow-panel-${active.id}`}
        key={active.id}
        role="tabpanel"
        aria-labelledby={`workflow-tab-${active.id}`}
        tabIndex={0}
      >
        <div className="workflow-panel-icon">
          <ActiveIcon aria-hidden="true" />
        </div>
        <div className="workflow-panel-copy">
          <p className="eyebrow">
            Stage {String(activeIndex + 1).padStart(2, "0")}
          </p>
          <h2>{active.title}</h2>
          <p>{active.description}</p>
        </div>
        <div className="workflow-io">
          <div>
            <span>Input</span>
            <strong>{active.input}</strong>
          </div>
          <ArrowRight aria-hidden="true" />
          <div>
            <span>Output</span>
            <strong>{active.output}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
