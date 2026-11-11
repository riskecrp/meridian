"use client";
import { toggleFactionImport } from "../../../fm/factions/actions.js";
import { Card, Empty, useAction } from "../../ui.js";

/* Authorized imports, grouped by tier. Toggling is L3 (toggleFactionImport);
   promotions change the set through the Review tab's Apply step. */
export default function Imports({ hub }) {
  const { detail, imports, isL3, archived, reload } = hub;
  const { run, busy } = useAction();
  const permitted = imports.filter(i => i.permitted).length;
  const canToggle = isL3 && !archived;
  const groups = Object.entries(imports.reduce((a, i) => { (a[i.tier] = a[i.tier] || []).push(i); return a; }, {})).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <Card title="Authorized imports" right={<span className="muted small">{permitted} / {imports.length}{canToggle ? " · toggle to change" : archived ? " · archived" : " · leadership manages"}</span>}>
      {imports.length === 0 ? <Empty title="No import items in the catalog.">Leadership adds them under Settings › Imports.</Empty> : groups.map(([tier, items]) => (
        <div key={tier}>
          <div className="grp">Tier {tier}{Number(tier) > detail.tier && <span className="faint"> · above this faction's tier</span>}</div>
          <div className="list">
            {items.map(i => (
              <div className="li" key={i.id}>
                <div className="body"><div className="t" style={{ fontWeight: i.permitted ? 600 : 500 }}>{i.name}</div>{i.category && <div className="d">{i.category}</div>}</div>
                <div className="side"><button className={`tg${i.permitted ? " on" : ""}`} disabled={!canToggle || busy} onClick={() => run(() => toggleFactionImport(detail.id, i.id, !i.permitted), { success: `${i.name} ${i.permitted ? "revoked" : "authorized"}.`, onDone: reload })}>{i.permitted ? "Authorized" : "Off"}</button></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}
