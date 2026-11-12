import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

import { REPO_URL, X_POST_URL } from "@/lib/config";

const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const display = Fraunces({ variable: "--font-display", subsets: ["latin"], axes: ["opsz"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Inheirit — a crypto will that doesn't make you prove you're alive",
  description:
    "Private signs of life, never silence alone, reversible stages across NEAR, Ethereum and Bitcoin. Testnet demo.",
};

export const viewport: Viewport = { themeColor: "#2f5d50" };

const NAV = [
  { href: "/account", label: "Your will" },
  { href: "/heartbeat", label: "Heartbeat" },
  { href: "/mainnet", label: "Mainnet" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${code.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
            <Link href="/" className="font-serif text-2xl">
              Inheirit
            </Link>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-muted hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
            <span>
              <span className="font-serif text-ink">Inheirit</span> · built at NEAR HACKATHON · NEAR testnet, free to try
            </span>
            <span className="flex gap-5">
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
                Code on GitHub
              </a>
              {X_POST_URL && (
                <a href={X_POST_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
                  Demo on X
                </a>
              )}
              <Link href="/mainnet" className="hover:text-ink">
                Mainnet
              </Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
