"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <button className="copy-button" type="button" onClick={() => void copy()}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? "Copied" : label}</span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
