"use client";
// The owner's area moved to /account (one screen per job). Old links, including ?as=<owner> from the
// role pages, land in the same place.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function OwnerRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/account${window.location.search}`);
  }, [router]);
  return <p className="text-muted">Opening your account…</p>;
}
