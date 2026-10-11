/**
 * WhatsApp share links. Pure (tested); shareText.ts opens them.
 *
 * whatsapp://send opens WhatsApp (or WhatsApp Business: both register the scheme) on its chat
 * picker with the text filled in. No phone number: we don't collect members' numbers, and picking
 * the group chat in WhatsApp is what people want anyway.
 *
 * Android caps intent data at a few hundred KB, far above our messages; MAX_SHARE_TEXT keeps a
 * runaway text (a 500-character note, a 40-person group) well inside it and readable.
 */

export const WHATSAPP_PROBE_URL = 'whatsapp://send?text=';
export const MAX_SHARE_TEXT = 3500;

/** Cut at a line end where possible, so a list is never cut mid-name. */
export function clampShareText(text: string, max = MAX_SHARE_TEXT): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max - 1);
  return `${text.slice(0, cut > max / 2 ? cut : max - 1)}…`;
}

export function whatsappSendUrl(text: string): string {
  return `whatsapp://send?text=${encodeURIComponent(clampShareText(text))}`;
}
