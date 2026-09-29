import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { supabaseReady } from "@/lib/data";
import type { ReactNode } from "react";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Deja Fix — hindsight for API & integration bugs",
  description:
    "Retain and recall every integration fix: verified knowledge cards, typed memory graphs, cited answers, delivered to Slack, Teams, your browser and MCP.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/ask", label: "Ask" },
  { href: "/cards", label: "Cards" },
  { href: "/review", label: "Review queue" },
  { href: "/graph", label: "Memory graph" },
  { href: "/reputation", label: "Reputation" },
  { href: "/integrations", label: "Integrations" },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const live = await supabaseReady();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-[#e7e0d2] bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-stone-800">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal-600 to-teal-400 font-mono text-sm font-bold text-white shadow-sm transition-transform duration-300 hover:rotate-180">
                ↻
              </span>
              Deja&nbsp;Fix
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-md px-3 py-1.5 text-stone-500 transition-all duration-200 hover:bg-[#f5f1e8] hover:text-stone-900"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <span
              className={`ml-auto chip ${live ? "chip-accent animate-pulse-soft" : "chip-amber"}`}
              title={live ? "Supabase tables detected" : "Supabase tables not applied yet — running on the demo corpus"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-teal-500" : "bg-amber-500"}`} />
              {live ? "Supabase live" : "Demo store"}
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-[#e7e0d2] bg-white/60 px-6 py-4 text-center text-xs text-stone-400">
          Deja Fix — retain once, recall forever · verification loop · typed memory · cited answers
        </footer>
      </body>
    </html>
  );
}
