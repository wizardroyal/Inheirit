"use client";
// Moved: Money is now Vault.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Moved() {
  const router = useRouter();
  useEffect(() => router.replace(`/account/vault${window.location.search}`), [router]);
  return null;
}
