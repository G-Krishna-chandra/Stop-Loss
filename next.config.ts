import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AgentMail lazily imports an optional payments package; load it from node_modules instead of bundling it.
  serverExternalPackages: ["agentmail"],
};

export default nextConfig;
