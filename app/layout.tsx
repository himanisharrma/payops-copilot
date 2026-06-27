import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayOps — Settlement Exception Desk",
  description:
    "Multi-PG settlement-exception desk for Indian merchant finance and payment-ops teams.",
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
