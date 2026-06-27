"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BookCheck,
  ChartNoAxesCombined,
  ChevronDown,
  FileClock,
  FlaskConical,
  Route,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

export type SecondaryNavKey =
  | "insights"
  | "root-causes"
  | "close"
  | "quality"
  | "demo"
  | "webhooks"
  | "audit";

export type SecondaryNavLink = {
  href: string;
  label: string;
  key: SecondaryNavKey;
};

const ICONS: Record<
  SecondaryNavKey,
  React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>
> = {
  insights: ChartNoAxesCombined,
  "root-causes": Waypoints,
  close: BookCheck,
  quality: FlaskConical,
  demo: Route,
  webhooks: ShieldCheck,
  audit: FileClock,
};

export function SecondaryNavMenu({
  links,
  activeKey,
}: {
  links: SecondaryNavLink[];
  activeKey: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeLink = links.find((link) => link.key === activeKey);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="secondary-nav" ref={wrapRef}>
      <button
        type="button"
        className={`product-nav-link secondary-nav-trigger ${
          activeLink ? "active" : ""
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {activeLink ? activeLink.label : "More"}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="secondary-nav-menu" role="menu">
          {links.map((link) => {
            const Icon = ICONS[link.key];
            return (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                className={`secondary-nav-item ${
                  link.key === activeKey ? "active" : ""
                }`}
                onClick={() => setOpen(false)}
              >
                <Icon size={15} aria-hidden />
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
