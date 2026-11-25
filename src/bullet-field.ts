// =============================================================
// Textfeld mit Aufzählungspunkten
// =============================================================
//
// Ein normales Textfeld. Zeilen, die mit "• " beginnen, werden im Bericht zu Aufzählungspunkten
// (parseBullets in control-fields.ts). Der Knopf setzt oder entfernt "• " vor den markierten Zeilen.
// Enter in einer Aufzählungszeile beginnt die nächste mit "• ", Enter in einer leeren beendet die Aufzählung.

import { isBulletLine } from './control-fields.ts';

const PREFIX = '• ';

export function initBulletField(textarea: HTMLTextAreaElement, button: HTMLButtonElement): void {
  // Der Knopf soll dem Textfeld den Fokus und die Markierung nicht nehmen
  button.addEventListener('pointerdown', (e) => e.preventDefault());
  button.addEventListener('click', () => toggleBullets(textarea));

  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const { value, selectionStart, selectionEnd } = textarea;
    if (selectionStart !== selectionEnd) return;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    if (!isBulletLine(line) && line.trim() !== '•') return;
    e.preventDefault();
    if (line.replace(/^\s*[•\-–]\s*/, '') === '') {
      // leerer Aufzählungspunkt: Aufzählung beenden
      textarea.setRangeText('', lineStart, selectionStart, 'end');
    } else {
      textarea.setRangeText(`\n${PREFIX}`, selectionStart, selectionEnd, 'end');
    }
    textarea.dispatchEvent(new Event('input'));
  });
}

// Alle markierten Zeilen (oder die Zeile mit dem Cursor) als Aufzählung oder, wenn sie das schon
// alle sind, wieder als normalen Text
function toggleBullets(textarea: HTMLTextAreaElement) {
  const { value, selectionStart, selectionEnd } = textarea;
  const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let end = value.indexOf('\n', selectionEnd);
  if (end === -1) end = value.length;
  const lines = value.slice(start, end).split('\n');
  // Leere Zeilen zählen nicht mit. Auf einer leeren Zeile beginnt der Knopf eine Aufzählung.
  const filled = lines.filter((line) => line.trim() && line.trim() !== '•');
  const allBullets = filled.length > 0 && filled.every((line) => isBulletLine(line));
  const changed = lines.map((line) => {
    if (allBullets) return line.replace(/^\s*[•\-–]\s+/, '');
    if (isBulletLine(line) || line.trim() === '•') return line;
    return lines.length > 1 && !line.trim() ? line : PREFIX + line;
  });
  textarea.focus();
  textarea.setRangeText(changed.join('\n'), start, end, 'end');
  textarea.dispatchEvent(new Event('input'));
}
