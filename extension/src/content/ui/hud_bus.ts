/**
 * Requests from the content script to the open HUD. A module-level channel inside the extension's
 * isolated world: unlike a window event, the page cannot send these.
 */
type Listener = () => void;
const pickListeners = new Set<Listener>();

export const hudBus = {
  /** Asks the HUD to start picking a target. */
  requestPick(): void {
    pickListeners.forEach((l) => l());
  },
  onPickRequest(listener: Listener): () => void {
    pickListeners.add(listener);
    return () => pickListeners.delete(listener);
  },
};
