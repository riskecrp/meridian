"use client";
import { useAuth } from "../../../../lib/useAuth";
import OperationsShell from "../_shared/Shell";
import DiscordAccessView from "./DiscordAccessView";

export default function DiscordAccessPage() {
  const auth = useAuth();

  if (auth.loading) return null;
  if (auth.level < 3) {
    return (
      <OperationsShell title="Discord & Access">
        <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
          These settings are limited to FM Leadership.
        </div>
      </OperationsShell>
    );
  }

  return (
    <OperationsShell title="Discord & Access">
      <DiscordAccessView />
    </OperationsShell>
  );
}
