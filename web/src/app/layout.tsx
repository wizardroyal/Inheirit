import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Black, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

import { REPO_URL, X_POST_URL } from "@/lib/config";

const body = Archivo({ variable: "--font-body", subsets: ["latin"] });
const display = Archivo_Black({ variable: "--font-display", subsets: ["latin"], weight: "400" });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Inheirit — a crypto will that doesn't make you prove you're alive",
  description:
    "Notices normal signs of life privately, never acts on silence alone, and hands assets on in reversible stages across NEAR, Ethereum and Bitcoin. Testnet demo.",
};

export const viewport: Viewport = { themeColor: "#0b0b0b" };

const NAV = [
  { href: "/owner", label: "Your will" },
  { href: "/heartbeat", label: "Heartbeat" },
  { href: "/mainnet", label: "Mainnet" },
  { href: "/demo", label: "Control panel" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${code.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line bg-ink text-bg">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-serif text-2xl">
              <span aria-hidden className="inline-block h-4 w-4 bg-accent-soft" />
              Inheirit
            </Link>
            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs uppercase tracking-wider">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="opacity-75 hover:opacity-100 hover:underline">
                  {n.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <div className="border-b border-line bg-accent-soft px-4 py-1.5 text-center font-mono text-[11px] uppercase tracking-wider text-ink">
          Built at NEAR HACKATHON · the will runs on NEAR testnet, so trying it costs nothing · the Shade Agent Framework is experimental
        </div>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line bg-ink text-bg">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 font-mono text-xs uppercase tracking-wider">
            <span>Inheirit · a will that doesn&apos;t make you prove you&apos;re alive</span>
            <span className="flex gap-5">
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:underline">
                Code on GitHub
              </a>
              {X_POST_URL && (
                <a href={X_POST_URL} target="_blank" rel="noreferrer" className="hover:underline">
                  Demo on X
                </a>
              )}
              <Link href="/mainnet" className="hover:underline">
                Mainnet
              </Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
