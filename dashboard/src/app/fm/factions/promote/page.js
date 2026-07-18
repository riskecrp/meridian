"use client";
import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getFactionDetail, stagePromotion } from "../actions";

const s = {
  btn: { background: 'var(--accent)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' },
  btnGhost: { background: 'transparent', color: 'var(--fg-3)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' },
  input: { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: 'var(--fg-0)', outline: 'none' },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 },
};

function PromoteInner() {
  const auth = useAuth();
  const router = useRouter();
  const { showAlert, showConfirm } = useDialog();

  const [factionName, setFactionName] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [promoTier, setPromoTier] = useState('');
  const [selectedImports, setSelectedImports] = useState([]);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Read ?name= from URL
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');
    if (name) setFactionName(decodeURIComponent(name));
  }, []);

  // Load faction detail when name is known
  useEffect(() => {
    if (!factionName || auth.loading) return;
    if (auth.level < 3) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const d = await getFactionDetail(factionName);
      if (d) {
        setDetail(d);
        // If a promotion is already staged, load THAT tier + import set so L3 can
        // review and adjust exactly what was staged. Otherwise pre-fill target =
        // current + 1 and the faction's currently-authorized imports.
        let pending = null;
        try { if (d.pendingPromo) pending = JSON.parse(d.pendingPromo); } catch (e) {}
        setPromoTier(String(pending?.tier ?? (d.tier + 1)));
        setSelectedImports(pending?.imports ?? d.authorizedItems ?? []);
      }
      setLoading(false);
    })();
  }, [factionName, auth.loading, auth.level]);

  const targetTierNum = parseInt(promoTier) || 0;

  // Compute tier-eligible items: only items at tier ≤ target
  const eligibleItems = useMemo(() => {
    if (!detail) return [];
    return (detail.allItems || []).filter(i => parseInt(i.tier || '1') <= targetTierNum);
  }, [detail, targetTierNum]);

  // Items ineligible because target tier is too low (only matters if currently authorized)
  const ineligibleAuthorized = useMemo(() => {
    if (!detail) return [];
    const current = new Set(detail.authorizedItems || []);
    return (detail.allItems || []).filter(i => current.has(i.name) && parseInt(i.tier || '1') > targetTierNum);
  }, [detail, targetTierNum]);

  // Filtered eligible items for the picker
  const filteredEligible = useMemo(() => {
    let items = eligibleItems;
    if (tierFilter !== null) items = items.filter(i => parseInt(i.tier || '1') === tierFilter);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q));
    }
    return items;
  }, [eligibleItems, tierFilter, search]);

  const groupedByTier = useMemo(() => {
    const g = {};
    filteredEligible.forEach(i => { const t = parseInt(i.tier || '1'); if (!g[t]) g[t] = []; g[t].push(i); });
    return g;
  }, [filteredEligible]);

  const tiersAvailable = useMemo(() => {
    return [...new Set(eligibleItems.map(i => parseInt(i.tier || '1')))].sort((a, b) => a - b);
  }, [eligibleItems]);

  const toggleItem = (name) => {
    setSelectedImports(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  // Diff for the preview
  const diff = useMemo(() => {
    if (!detail) return { added: [], removed: [], unchanged: [] };
    const current = new Set(detail.authorizedItems || []);
    const next = new Set(selectedImports);
    const added = [...next].filter(n => !current.has(n));
    const removed = [...current].filter(n => !next.has(n));
    const unchanged = [...current].filter(n => next.has(n));
    return { added, removed, unchanged };
  }, [detail, selectedImports]);

  const selectAllAtTier = (tier) => {
    const names = eligibleItems.filter(i => parseInt(i.tier || '1') === tier).map(i => i.name);
    setSelectedImports(prev => [...new Set([...prev, ...names])]);
  };

  const clearTier = (tier) => {
    const names = new Set(eligibleItems.filter(i => parseInt(i.tier || '1') === tier).map(i => i.name));
    setSelectedImports(prev => prev.filter(n => !names.has(n)));
  };

  const handleStage = async () => {
    if (!detail || !promoTier) return;
    if (targetTierNum <= detail.tier) {
      const ok = await showConfirm(`Target tier (T${targetTierNum}) is not higher than current (T${detail.tier}). Stage anyway?`);
      if (!ok) return;
    }
    if (ineligibleAuthorized.length > 0) {
      const names = ineligibleAuthorized.map(i => i.name).join(', ');
      const ok = await showConfirm(`These items are above target tier T${targetTierNum} and will be REMOVED:\n\n${names}\n\nProceed?`);
      if (!ok) return;
    }
    setSubmitting(true);
    // Filter selectedImports to only tier-eligible items (safety)
    const eligibleNames = new Set(eligibleItems.map(i => i.name));
    const finalImports = selectedImports.filter(n => eligibleNames.has(n));
    await stagePromotion(detail.id, detail.name, promoTier, finalImports);
    setSubmitting(false);
    await showAlert(`✅ Promotion staged for ${detail.name} → Tier ${promoTier}.\n\nFlag: faction card now shows PENDING.\nTag: team-lead channel notified.\nAwaiting RP confirmation.`);
    router.push('/fm/factions');
  };

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>Access denied. L3 (Management) required to stage promotions.</div>;
  if (!factionName) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>No faction specified. Open this page via "Stage Promotion" from a faction card.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading faction dossier...</div>;
  if (!detail) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>Faction not found: {factionName}</div>;

  const hasPending = !!detail.pendingPromo;

  return (
    <div className="w-full max-w-[1600px] mx-auto p-6 lg:p-10 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end pb-6" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <Link href="/fm/factions" className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--fg-4)' }}>← Back to Factions</Link>
          <h1 className="text-3xl font-black tracking-tighter italic uppercase mt-1">Stage Promotion</h1>
          <div className="text-sm mt-1" style={{ color: 'var(--fg-3)' }}>
            <span className="font-bold">{detail.name}</span> · Currently <span className="font-mono px-2 py-0.5 rounded text-[11px]" style={{background:'var(--bg-2)',color:'var(--fg-2)'}}>T{detail.tier}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/fm/factions" style={s.btnGhost}>Cancel</Link>
          <button style={s.btn} onClick={handleStage} disabled={submitting || !promoTier}>
            {submitting ? 'Staging...' : 'Stage Promotion'}
          </button>
        </div>
      </div>

      {/* Pending warning */}
      {hasPending && (
        <div className="p-4 rounded-xl" style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber)' }}>
          <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--amber)' }}>⚠️ Adjusting a Staged Promotion</div>
          <div className="text-sm" style={{ color: 'var(--fg-2)' }}>Loaded with the currently staged tier and imports. Submitting will <strong>replace</strong> the staged promotion with your changes.</div>
        </div>
      )}

      {/* Target tier */}
      <div className="rounded-xl p-5" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <div style={s.label}>Target Tier</div>
            <input type="number" min="0" max="9" style={{ ...s.input, maxWidth: 120, fontSize: 18, fontWeight: 700 }} value={promoTier} onChange={e => setPromoTier(e.target.value)} />
          </div>
          <div className="flex-1 text-[12px]" style={{ color: 'var(--fg-3)' }}>
            <div style={s.label}>Promotion Path</div>
            <div className="flex items-center gap-2 text-base">
              <span className="font-mono px-3 py-1 rounded" style={{background:'var(--bg-2)',color:'var(--fg-2)'}}>T{detail.tier}</span>
              <span style={{color:'var(--fg-4)'}}>→</span>
              <span className="font-mono px-3 py-1 rounded font-bold" style={{background: targetTierNum > detail.tier ? 'var(--green-bg)' : 'var(--bg-2)', color: targetTierNum > detail.tier ? 'var(--green)' : 'var(--fg-2)'}}>T{targetTierNum}</span>
            </div>
          </div>
          <div className="flex-1 text-[11px]" style={{ color: 'var(--fg-4)' }}>
            On stage: <strong style={{color:'var(--accent)'}}>flag</strong> set on faction card, <strong style={{color:'var(--accent)'}}>tag</strong> sent to team-lead channel. RP confirmation required to complete.
          </div>
        </div>
      </div>

      {/* Diff preview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--green-bg)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--green)' }}>+ Adding ({diff.added.length})</div>
          <div className="text-[12px] space-y-0.5 max-h-40 overflow-y-auto scr">
            {diff.added.length === 0 && <div className="italic" style={{color:'var(--fg-4)'}}>No new imports</div>}
            {diff.added.map(n => <div key={n} style={{color:'var(--green)'}}>+ {n}</div>)}
          </div>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--fg-3)' }}>= Keeping ({diff.unchanged.length})</div>
          <div className="text-[12px] space-y-0.5 max-h-40 overflow-y-auto scr">
            {diff.unchanged.length === 0 && <div className="italic" style={{color:'var(--fg-4)'}}>None</div>}
            {diff.unchanged.map(n => <div key={n} style={{color:'var(--fg-3)'}}>{n}</div>)}
          </div>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--red-bg)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--red)' }}>− Removing ({diff.removed.length})</div>
          <div className="text-[12px] space-y-0.5 max-h-40 overflow-y-auto scr">
            {diff.removed.length === 0 && <div className="italic" style={{color:'var(--fg-4)'}}>None removed</div>}
            {diff.removed.map(n => <div key={n} style={{color:'var(--red)'}}>− {n}</div>)}
          </div>
        </div>
      </div>

      {/* Ineligible warning */}
      {ineligibleAuthorized.length > 0 && (
        <div className="p-3 rounded-lg" style={{ background: 'var(--red-bg)', border: '1px solid var(--red)' }}>
          <div className="text-[11px] font-bold uppercase mb-1" style={{ color: 'var(--red)' }}>Above Target Tier — will be removed on promotion</div>
          <div className="text-[12px]" style={{ color: 'var(--fg-2)' }}>
            {ineligibleAuthorized.map(i => `${i.name} (T${i.tier})`).join(' · ')}
          </div>
        </div>
      )}

      {/* Item picker */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--fg-2)' }}>Available Imports for T{targetTierNum}</div>
          <input style={{ ...s.input, maxWidth: 250, padding: '6px 12px', fontSize: 12 }} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex gap-1 ml-auto">
            <button onClick={() => setTierFilter(null)} className="px-3 py-1 rounded text-[10px] font-bold uppercase" style={{background:tierFilter===null?'var(--accent)':'var(--bg-2)',color:tierFilter===null?'white':'var(--fg-3)',border:'1px solid var(--border)',cursor:'pointer'}}>All</button>
            {tiersAvailable.map(t => (
              <button key={t} onClick={() => setTierFilter(t)} className="px-3 py-1 rounded text-[10px] font-bold uppercase" style={{background:tierFilter===t?'var(--accent)':'var(--bg-2)',color:tierFilter===t?'white':'var(--fg-3)',border:'1px solid var(--border)',cursor:'pointer'}}>T{t}</button>
            ))}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--fg-4)' }}>
            <strong style={{color:'var(--accent)'}}>{selectedImports.filter(n => eligibleItems.some(i => i.name === n)).length}</strong> selected
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto scr p-4 space-y-4">
          {Object.keys(groupedByTier).sort((a,b) => parseInt(a) - parseInt(b)).map(tier => (
            <div key={tier}>
              <div className="flex justify-between items-center mb-2">
                <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Tier {tier} ({groupedByTier[tier].length})</div>
                <div className="flex gap-1">
                  <button onClick={() => selectAllAtTier(parseInt(tier))} className="text-[9px] font-bold uppercase px-2 py-0.5 rounded" style={{background:'var(--bg-2)',color:'var(--fg-3)',border:'1px solid var(--border)',cursor:'pointer'}}>Select all</button>
                  <button onClick={() => clearTier(parseInt(tier))} className="text-[9px] font-bold uppercase px-2 py-0.5 rounded" style={{background:'var(--bg-2)',color:'var(--fg-3)',border:'1px solid var(--border)',cursor:'pointer'}}>Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
                {groupedByTier[tier].sort((a,b) => (a.category||'').localeCompare(b.category||'') || a.name.localeCompare(b.name)).map(item => {
                  const checked = selectedImports.includes(item.name);
                  return (
                    <div key={item.id} onClick={() => toggleItem(item.name)} className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer" style={{
                      background: checked ? 'var(--green-bg)' : 'var(--bg-2)',
                      border: checked ? '1px solid var(--green)' : '1px solid var(--border)',
                    }}>
                      <span style={{ fontSize: 14 }}>{checked ? '✅' : '⬜'}</span>
                      <span className="text-sm truncate flex-1" style={{ color: checked ? 'var(--green)' : 'var(--fg-2)' }}>{item.name}</span>
                      {item.category && <span className="text-[9px]" style={{ color: 'var(--fg-4)' }}>{item.category}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {Object.keys(groupedByTier).length === 0 && (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--fg-4)' }}>No items match your filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PromotePage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>}>
      <PromoteInner />
    </Suspense>
  );
}
