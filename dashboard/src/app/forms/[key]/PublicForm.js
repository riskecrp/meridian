"use client";
import { useState } from 'react';
import { formDef, validateSubmission, HONEYPOT_FIELD } from '../../../lib/formDefs.js';
import { submitPublicForm } from '../actions.js';

// The form itself. Validation runs here first (same function the server uses)
// so a missed required field is pointed at inline; the server validates again
// and is the one that counts. The hidden `website` field is the honeypot: a
// browser never fills it, a form-stuffing bot does.

export default function PublicForm({ formKey }) {
  const def = formDef(formKey);
  const [values, setValues] = useState({});
  const [hp, setHp] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  if (!def) return <main className="pf-page"><div className="pf-wrap"><div className="pf-card">This form does not exist. <a className="pf-link" href="/forms">All forms</a></div></div></main>;

  const set = (name, v) => { setValues((s) => ({ ...s, [name]: v })); if (errors[name]) setErrors((e) => { const n = { ...e }; delete n[name]; return n; }); };

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const local = validateSubmission(def, values);
    if (!local.ok) { setErrors(local.errors); setError('Check the highlighted fields.'); return; }
    setBusy(true);
    try {
      const r = await submitPublicForm(def.key, values, { [HONEYPOT_FIELD]: hp });
      if (r?.ok) { setDone(r.reference); window.scrollTo?.(0, 0); }
      else { setErrors(r?.errors || {}); setError(r?.error || 'Something went wrong. Try again.'); }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return (
    <main className="pf-page">
      <div className="pf-wrap">
        <div className="pf-brand">
          <div className="pf-logo">Meridian</div>
          <div className="pf-sub">Faction Management</div>
        </div>
        <div className="pf-card">
          {done ? (
            <div className="pf-thanks">
              <div className="pf-check">✓</div>
              <h1 className="pf-title">Received</h1>
              <p className="pf-intro">Your {def.short.toLowerCase()} has reached Faction Management. Keep this reference in case you need to ask about it:</p>
              <div className="pf-ref">{done}</div>
              <p className="pf-intro" style={{ marginBottom: 0 }}>The team will be in touch on Discord. <a className="pf-link" href="/forms">Back to all forms</a></p>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <h1 className="pf-title">{def.title}</h1>
              <p className="pf-intro">{def.intro}</p>
              {error && <div className="pf-alert" role="alert">{error}</div>}
              {def.fields.map((f) => <Field key={f.name} f={f} value={values[f.name] ?? ''} error={errors[f.name]} onChange={(v) => set(f.name, v)} />)}
              <div className="pf-hp" aria-hidden="true">
                <label>Website<input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
              </div>
              <button type="submit" className="pf-btn" disabled={busy}>{busy ? 'Sending…' : 'Submit'}</button>
            </form>
          )}
        </div>
        <p className="pf-foot"><a href="/forms">All forms</a> · Submissions are read by Faction Management staff only.</p>
      </div>
    </main>
  );
}

function Field({ f, value, error, onChange }) {
  const id = `f-${f.name.replace(/\W+/g, '-').toLowerCase()}`;
  const label = (
    <label className="pf-label" htmlFor={id}>{f.label || f.name}{f.required && f.type !== 'fixed' ? <span className="req" aria-hidden="true">*</span> : null}</label>
  );
  let input;
  if (f.type === 'fixed') input = <div className="pf-fixed" id={id}>{f.value}</div>;
  else if (f.type === 'textarea') input = <textarea id={id} className="pf-textarea" value={value} onChange={(e) => onChange(e.target.value)} maxLength={4000} required={!!f.required} />;
  else if (f.type === 'select') input = (
    <select id={id} className="pf-select" value={value} onChange={(e) => onChange(e.target.value)} required={!!f.required}>
      <option value="">Choose…</option>
      {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  else input = (
    <input id={id} className="pf-input"
      type={f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'}
      inputMode={f.type === 'url' ? 'url' : 'text'}
      autoComplete={f.type === 'discord' ? 'username' : 'off'}
      placeholder={f.type === 'discord' ? 'username' : f.type === 'url' ? 'https://' : ''}
      value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} required={!!f.required} />
  );
  return (
    <div className={`pf-field${error ? ' has-error' : ''}`}>
      {label}
      {input}
      {f.help && !error && <div className="pf-help">{f.help}</div>}
      {error && <div className="pf-error">{error}</div>}
    </div>
  );
}
