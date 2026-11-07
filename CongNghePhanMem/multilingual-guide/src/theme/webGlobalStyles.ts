import { Platform } from 'react-native';
import { C } from './colors';

const CSS = `
html, body, #root { background: ${C.paper}; }
html { -webkit-text-size-adjust: 100%; }
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  overscroll-behavior-y: none;
}
* { -webkit-tap-highlight-color: transparent; }
input, textarea, select { font-family: inherit; font-size: 16px; }
input:focus, textarea:focus, select:focus { outline: none; }
input:focus-visible, textarea:focus-visible {
  box-shadow: 0 0 0 3px ${C.primarySoft};
}
[role="button"], [role="link"], [role="tab"], [role="radio"], a { cursor: pointer; }
[role="button"]:focus-visible, [role="link"]:focus-visible, [role="tab"]:focus-visible, [role="radio"]:focus-visible, a:focus-visible {
  outline: 2px solid ${C.primary};
  outline-offset: 2px;
}
[role="button"], [role="link"], [role="tab"] { transition: background-color .15s ease, opacity .15s ease, transform .12s ease; }
[role="button"]:active { transform: scale(.985); }
::-webkit-scrollbar { width: 10px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 10px; border: 2px solid ${C.paper}; }
::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
* { scrollbar-width: thin; scrollbar-color: #CBD5E1 transparent; }
::selection { background: ${C.primarySoft}; }
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

/** Injects web-only polish (focus rings, tap highlight, scrollbars). No-op on native. */
export function installWebGlobalStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('app-global-styles')) return;
  const style = document.createElement('style');
  style.id = 'app-global-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta); }
  meta.setAttribute('content', C.white);
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
  if (!document.title || document.title === 'multilingual-guide') document.title = 'Quận 1 Audio Guide · TP. Hồ Chí Minh';
}
