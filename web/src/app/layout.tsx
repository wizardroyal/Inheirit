import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

import { HeaderNav } from "@/components/HeaderNav";
import { REPO_URL, X_POST_URL } from "@/lib/config";

const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const display = Fraunces({ variable: "--font-display", subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Inheirit — a crypto will that doesn't make you prove you're alive",
  description:
    "Private signs of life, never silence alone, staged release across NEAR, Ethereum and Bitcoin (unsent slices can still be stopped). Testnet demo.",
};

export const viewport: Viewport = { themeColor: "#3b6a2c" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${code.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <span className="flex items-center gap-2">
              <Link href="/" className="font-serif text-2xl">
                Inheirit
              </Link>
              <span title="Everything runs on test networks: no real money" className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                Testnet
              </span>
            </span>
            <HeaderNav />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
            <span>
              <span className="font-serif text-ink">Inheirit</span> · built at NEAR HACKATHON · Testnet is open to everyone. Mainnet is a capped showcase.
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
