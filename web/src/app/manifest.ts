import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Inheirit Heartbeat",
    short_name: "Heartbeat",
    description: "Tell your will agent you're here.",
    start_url: "/heartbeat",
    display: "standalone",
    background_color: "#f7f5f0",
    theme_color: "#2f5d50",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
