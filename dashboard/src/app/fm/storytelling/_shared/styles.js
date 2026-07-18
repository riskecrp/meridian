// Shared inline styles for all storytelling pages
export const s = {
  btn: { background:'var(--accent)',color:'white',border:'none',padding:'7px 14px',borderRadius:6,fontSize:11,fontWeight:800,cursor:'pointer',textTransform:'uppercase',letterSpacing:'0.06em' },
  btnGhost: { background:'transparent',color:'var(--fg-3)',border:'1px solid var(--border)',padding:'5px 12px',borderRadius:6,fontSize:10,fontWeight:700,cursor:'pointer',textTransform:'uppercase' },
  btnSm: { background:'none',border:'none',cursor:'pointer',fontSize:10,fontWeight:700,padding:'2px 5px' },
  input: { width:'100%',background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',fontSize:13,color:'var(--fg-0)',outline:'none' },
  label: { fontSize:10,fontWeight:700,color:'var(--fg-4)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3 },
  modal: { position:'fixed',inset:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:24 },
  modalBg: { position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',backdropFilter:'blur(6px)' },
};
