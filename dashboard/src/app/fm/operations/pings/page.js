"use client";
import { useAuth } from "../../../../lib/useAuth";
import OperationsShell from "../_shared/Shell";
import PingsView from "./PingsView";

export default function PingsPage() {
  const auth = useAuth();

  if (auth.loading) return null;
  if (auth.level < 3) {
    return (
      <OperationsShell title="Pings">
        <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
          Ping configuration is limited to FM Leadership.
        </div>
      </OperationsShell>
    );
  }

  return (
    <OperationsShell title="Pings">
      <PingsView />
    </OperationsShell>
  );
}
