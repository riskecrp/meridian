import { ui } from "../../../../lib/ui.js";
// Shared inline styles for all storytelling pages
export const s = {
  ...ui,
  modal: { position:'fixed',inset:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:24 },
  modalBg: { position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',backdropFilter:'blur(6px)' },
};
