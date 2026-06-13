import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayOps Copilot",
  description: "Payment reconciliation workspace for Indian operations teams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
