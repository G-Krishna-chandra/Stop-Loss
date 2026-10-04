import { notFound } from "next/navigation";
import { has } from "@/config";
import { getRun } from "@/db";
import { RunView } from "@/surface/RunView";
import { SetupNeeded } from "@/surface/SetupNeeded";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  if (!has("DATABASE_URL")) return <SetupNeeded keys={["DATABASE_URL"]} what="Agent runs" />;
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  return <RunView initial={run} />;
}
