import { useEffect, useState } from 'react';

// Home Assistant's app panel (ha-panel-app) listens for these postMessage calls from the
// ingress iframe. Kiosk mode hides HA's sidebar and header for as long as the panel is open;
// HA switches it off again when the user leaves the panel.

/** True when the page runs inside Home Assistant's ingress panel. */
export const inHaPanel = window.parent !== window && /\/api\/hassio_ingress\//.test(location.pathname);

const post = (msg: Record<string, unknown>) => window.parent.postMessage(msg, '*');

export function toggleHaMenu() {
  post({ type: 'home-assistant/toggle-menu' });
}

/**
 * Shows the dashboard full screen inside Home Assistant. Returns true once HA answers,
 * so older Home Assistant versions without the protocol don't get a dead menu item.
 */
export function useHaFullscreen(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!inHaPanel) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && e.data?.type === 'home-assistant/properties') setSupported(true);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'home-assistant/subscribe-properties', kioskMode: true });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return supported;
}
