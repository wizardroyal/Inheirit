"use client";
// Moved: People are now on My will.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Moved() {
  const router = useRouter();
  useEffect(() => router.replace(`/account/will${window.location.search}`), [router]);
  return null;
}
