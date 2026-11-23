// =============================================================
// Fenster "Textbausteine": auswählen, suchen, ergänzen, löschen
// =============================================================

import * as store from './db.ts';
import type { TextBlock } from './types.ts';

const dialog = document.getElementById('text-blocks-dialog') as HTMLElement;
const input = document.getElementById('text-block-input') as HTMLInputElement;
const addBtn = document.getElementById('text-block-add') as HTMLButtonElement;
const list = document.getElementById('text-block-list') as HTMLElement;
const message = document.getElementById('text-block-message') as HTMLElement;

let blocks: TextBlock[] = [];
let onPick: ((text: string) => void) | null = null;

// Das Eingabefeld bekommt bewusst keinen Fokus: Die iPad-Tastatur würde die Liste verdecken
export async function openTextBlocks(pick: (text: string) => void): Promise<void> {
  onPick = pick;
  input.value = '';
  message.textContent = '';
  blocks = await store.listTextBlocks();
  render();
  dialog.hidden = false;
}

function closeDialog() {
  dialog.hidden = true;
  onPick = null;
}

function render() {
  const text = input.value.trim().toLowerCase();
  const visible = blocks.filter((block) => block.text.toLowerCase().includes(text));
  addBtn.disabled = !text || blocks.some((block) => block.text.toLowerCase() === text);

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = text ? 'Kein passender Baustein.' : 'Noch keine Textbausteine.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...visible.map(createItem));
}

function createItem(block: TextBlock) {
  const item = document.createElement('div');
  item.className = 'text-block';

  const pick = document.createElement('button');
  pick.className = 'text-block-pick';
  pick.textContent = block.text;
  pick.addEventListener('click', () => {
    onPick!(block.text);
    closeDialog();
  });

  const del = document.createElement('button');
  del.className = 'btn icon danger';
  del.textContent = '×';
  del.setAttribute('aria-label', `Baustein „${block.text}“ löschen`);
  del.addEventListener('click', () => removeBlock(block));

  item.append(pick, del);
  return item;
}

async function removeBlock(block: TextBlock) {
  if (!confirm(`Baustein „${block.text}“ löschen? Vorhandene Mängel bleiben unverändert.`)) return;
  try {
    await store.deleteTextBlock(block.id);
    blocks = blocks.filter((b) => b !== block);
    render();
  } catch (err) {
    console.error(err);
    message.textContent = 'Der Baustein konnte nicht gelöscht werden.';
  }
}

input.addEventListener('input', render);

addBtn.addEventListener('click', async () => {
  try {
    await store.addTextBlock(input.value.trim());
    input.value = '';
    message.textContent = '';
    blocks = await store.listTextBlocks();
    render();
  } catch (err) {
    console.error(err);
    message.textContent = 'Der Baustein konnte nicht gespeichert werden. Ist der Speicher voll?';
  }
});

document.getElementById('text-blocks-close')!.addEventListener('click', closeDialog);
