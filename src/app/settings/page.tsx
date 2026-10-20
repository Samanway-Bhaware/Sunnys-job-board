import type { Metadata } from "next";
import SettingsForm from "@/components/settings/SettingsForm";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsForm />;
}
