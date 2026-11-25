"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Vuelve a pedir la página al servidor cada cierto tiempo (mientras hay análisis en curso). */
export default function Refrescar({ cadaMs }: { cadaMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), cadaMs);
    return () => clearInterval(t);
  }, [router, cadaMs]);
  return null;
}
