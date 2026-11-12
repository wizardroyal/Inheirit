"use client";
// Older invite links: /join/<owner>#c=<code>&r=<role>&n=<name>. New links are /i/<code>.
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { JoinView } from "@/components/JoinView";

/** Older links: /join/<owner>#c=<code>&r=<role>&n=<name>. New links are /i/<code> (app/i/[code]). */
export default function JoinPage() {
  const owner = decodeURIComponent(useParams<{ owner: string }>().owner);
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => setParams(new URLSearchParams(window.location.hash.slice(1))), []);
  if (!params) return <p>Loading…</p>;
  return <JoinView owner={owner} code={params.get("c") ?? ""} role={params.get("r") ?? ""} name={params.get("n") ?? ""} />;
}

