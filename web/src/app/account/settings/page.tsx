"use client";
// Moved: Settings are now part of Profile.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Moved() {
  const router = useRouter();
  useEffect(() => router.replace(`/account/profile${window.location.search}`), [router]);
  return null;
}
