"use client";
import { deleteMember } from "../../../fm/factions/actions.js";
import { Card, Button, Empty, useAction } from "../../ui.js";
import { RoleBadge } from "../shared.js";

export default function Roster({ hub }) {
  const { detail, canWrite, setModal, reload } = hub;
  const { run, busy } = useAction();
  const del = (m) => { if (window.confirm(`Remove ${m.character_name} from the roster?`)) run(() => deleteMember(m.id), { success: `${m.character_name} removed.`, onDone: reload }); };
  return (
    <Card flush title="Known command & members" right={canWrite ? <Button size="sm" onClick={() => setModal({ kind: "member" })}>+ Add member</Button> : <span className="faint small">{detail.members.length} on file</span>}>
      {detail.members.length === 0 ? <div style={{ padding: "0 16px 16px" }}><Empty title="No members on file.">{canWrite ? "Add the characters you know hold command." : null}</Empty></div> : (
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Character</th><th>Role</th><th className="hide-sm">Phone</th><th className="hide-sm">Residence</th>{canWrite && <th></th>}</tr></thead>
            <tbody>
              {detail.members.map(m => (
                <tr key={m.id}>
                  <td><b>{m.character_name}</b><div className="only-sm muted tiny">{m.phone !== "N/A" ? m.phone : ""}{m.phone !== "N/A" && m.residence !== "N/A" ? " · " : ""}{m.residence !== "N/A" ? m.residence : ""}</div></td>
                  <td><RoleBadge role={m.is_leader} /></td>
                  <td className="muted hide-sm">{m.phone}</td>
                  <td className="muted hide-sm">{m.residence}</td>
                  {canWrite && <td><span className="actions-inline"><Button size="sm" variant="ghost" onClick={() => setModal({ kind: "member", member: m })}>Edit</Button><Button size="sm" variant="danger ghost" disabled={busy} onClick={() => del(m)}>Remove</Button></span></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
