// Clipboard.js — one safe clipboard path for share codes and diagnostics.
// Browser permissions can be unavailable in offline/PWA contexts, so every
// caller receives a boolean and can expose a manual-copy fallback.

export async function copyText(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the synchronous legacy path.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand?.('copy') === true;
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

