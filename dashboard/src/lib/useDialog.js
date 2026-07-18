"use client";
import { useState, useCallback, createContext, useContext } from "react";

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const showConfirm = useCallback((message, title) => {
    return new Promise(resolve => {
      setDialog({ type: 'confirm', title: title || 'Confirm', message, resolve });
    });
  }, []);

  const showPrompt = useCallback((title, defaultValue, options) => {
    return new Promise(resolve => {
      setDialog({ type: 'prompt', title, defaultValue: defaultValue || '', resolve, multiline: options?.multiline, placeholder: options?.placeholder });
    });
  }, []);

  const showAlert = useCallback((message, title) => {
    return new Promise(resolve => {
      setDialog({ type: 'alert', title: title || 'Notice', message, resolve });
    });
  }, []);

  const showForm = useCallback((title, fields) => {
    return new Promise(resolve => {
      setDialog({ type: 'form', title, fields, resolve });
    });
  }, []);

  const handleSubmit = () => {
    if (!dialog) return;
    if (dialog.type === 'confirm') dialog.resolve(true);
    else if (dialog.type === 'alert') dialog.resolve(true);
    else if (dialog.type === 'prompt') {
      const el = document.getElementById('dlg-prompt-input');
      dialog.resolve(el?.value ?? '');
    }
    else if (dialog.type === 'form') {
      const result = {};
      dialog.fields.forEach(f => {
        const el = document.getElementById(`dlg-field-${f.name}`);
        if (f.type === 'checkbox') result[f.name] = el?.checked || false;
        else if (f.type === 'select') result[f.name] = el?.value || '';
        else result[f.name] = el?.value || '';
      });
      dialog.resolve(result);
    }
    setDialog(null);
  };

  const handleCancel = () => {
    if (!dialog) return;
    if (dialog.type === 'confirm') dialog.resolve(false);
    else dialog.resolve(null);
    setDialog(null);
  };

  const inputStyle = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--fg-0)', outline: 'none' };

  return (
    <DialogContext.Provider value={{ showConfirm, showPrompt, showAlert, showForm }}>
      {children}
      {dialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }} onClick={handleCancel} />
          <div style={{ position: 'relative', width: '100%', maxWidth: dialog.type === 'form' ? 500 : 420, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{dialog.title}</span>
              <button onClick={handleCancel} style={{ color: 'var(--fg-4)', fontSize: 18, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              {dialog.message && <p style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6, marginBottom: 16 }}>{dialog.message}</p>}

              {dialog.type === 'prompt' && (
                dialog.multiline
                  ? <textarea id="dlg-prompt-input" autoFocus defaultValue={dialog.defaultValue} placeholder={dialog.placeholder || ''} style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }} />
                  : <input id="dlg-prompt-input" autoFocus type="text" defaultValue={dialog.defaultValue} placeholder={dialog.placeholder || ''} style={inputStyle} />
              )}

              {dialog.type === 'form' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {dialog.fields.map(f => (
                    <div key={f.name}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>{f.label}</div>
                      {f.type === 'select' ? (
                        <select id={`dlg-field-${f.name}`} defaultValue={f.default || ''} style={inputStyle}>
                          {f.placeholder && <option value="">{f.placeholder}</option>}
                          {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : f.type === 'checkbox' ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input id={`dlg-field-${f.name}`} type="checkbox" defaultChecked={f.default || false} />
                          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{f.checkLabel || 'Yes'}</span>
                        </label>
                      ) : f.type === 'textarea' ? (
                        <textarea id={`dlg-field-${f.name}`} defaultValue={f.default || ''} placeholder={f.placeholder || ''} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
                      ) : f.type === 'datetime-local' ? (
                        <input id={`dlg-field-${f.name}`} type="datetime-local" defaultValue={f.default || ''} style={inputStyle} />
                      ) : f.type === 'number' ? (
                        <input id={`dlg-field-${f.name}`} type="number" defaultValue={f.default || ''} min={f.min} max={f.max} style={inputStyle} />
                      ) : (
                        <input id={`dlg-field-${f.name}`} type="text" defaultValue={f.default || ''} placeholder={f.placeholder || ''} style={inputStyle} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {dialog.type !== 'alert' && (
                <button onClick={handleCancel} style={{ background: 'transparent', color: 'var(--fg-3)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' }}>Cancel</button>
              )}
              <button onClick={handleSubmit} style={{ background: 'var(--accent)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase' }}>
                {dialog.type === 'alert' ? 'OK' : dialog.type === 'confirm' ? 'Confirm' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}
