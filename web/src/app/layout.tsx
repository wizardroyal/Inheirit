import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const display = Source_Serif_4({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Inheirit — a crypto will that doesn't make you prove you're alive",
  description:
    "Notices normal signs of life privately, never acts on silence alone, and hands assets on in reversible stages across NEAR, Ethereum and Bitcoin. Testnet demo.",
};

export const viewport: Viewport = { themeColor: "#2f5d50" };

const NAV = [
  { href: "/owner", label: "Your will" },
  { href: "/demo", label: "Demo panel" },
  { href: "/heartbeat", label: "Heartbeat" },
  { href: "/mainnet", label: "Mainnet" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="font-serif text-xl">
              Inheirit
            </Link>
            <div className="flex gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-muted hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <div className="bg-warn-soft px-4 py-1 text-center text-xs text-warn">
          Built at NEAR HACKATHON. Runs on testnet, so nothing here costs real money. The Shade Agent Framework it uses is experimental.
        </div>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
