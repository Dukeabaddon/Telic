import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import type { ReactNode } from "react";

import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteConfig } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "Telic — The workflow spine for coding agents",
    template: "%s — Telic",
  },
  description: siteConfig.description,
  applicationName: "Telic",
  authors: [{ name: "Telic", url: siteConfig.github }],
  creator: "Telic",
  keywords: [
    "coding agents",
    "MCP",
    "developer tools",
    "agent workflow",
    "Codex plugin",
    "evidence",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Telic",
    title: "Telic — The workflow spine for coding agents",
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: "Telic — The workflow spine for coding agents",
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#090909",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader />
        <ScrollReveal />
        {children}
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
