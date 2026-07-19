import { Brand } from "@/components/logo";
import { TrackedLink } from "@/components/tracked-link";
import { siteConfig } from "@/lib/site";

const groups = [
  {
    title: "Product",
    links: [
      ["How it works", "/how-it-works"],
      ["Install", "/install"],
    ],
  },
  {
    title: "Resources",
    links: [
      ["GitHub", siteConfig.github],
      ["npm", siteConfig.npm],
      ["Documentation", siteConfig.docs],
      ["Report an issue", siteConfig.issues],
    ],
  },
  {
    title: "Open source",
    links: [
      ["Security", `${siteConfig.github}/blob/main/SECURITY.md`],
      ["Privacy", `${siteConfig.github}/blob/main/PRIVACY.md`],
      ["MIT License", `${siteConfig.github}/blob/main/LICENSE`],
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand">
          <Brand />
          <p>The workflow spine for coding agents.</p>
          <span>Local control. Evidence-linked results.</span>
        </div>
        {groups.map((group) => (
          <div className="footer-group" key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.links.map(([label, href]) => (
                <li key={href}>
                  <TrackedLink
                    eventName={`footer_${label.toLowerCase().replaceAll(" ", "_")}`}
                    href={href}
                    {...(href.startsWith("http")
                      ? { target: "_blank", rel: "noreferrer" }
                      : {})}
                  >
                    {label}
                  </TrackedLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="shell footer-bottom">
        <span>© {new Date().getFullYear()} Telic</span>
        <span>Open source · Built in the open</span>
      </div>
    </footer>
  );
}
