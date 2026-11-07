import './style.css';
import { importAnki } from './anki';
import { downloadPack, emptyPack, importDelimited, packStats, preparePack, serializePack } from './pack';
import { Catalog, CatalogEntry, PackCard, StudyPack, bytesLabel, cardCount, chapterCount, sha256, validatePack } from './types';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const packDialog = document.querySelector<HTMLDialogElement>('#pack-dialog')!;
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));

let draft = emptyPack();
let curated: CatalogEntry[] = [];
let localPacks: CatalogEntry[] = [];
let filter = 'all';
let catalogError = '';

try {
  const saved = JSON.parse(localStorage.getItem('quizready.myPacks') ?? '[]') as CatalogEntry[];
  localPacks = saved.filter((entry) => entry.local && entry.document).map((entry) => ({ ...entry, document: validatePack(entry.document) }));
} catch {
  localPacks = [];
}

function status(element: HTMLElement, message: string, error = false): void {
  element.textContent = message;
  element.classList.toggle('error', error);
}

function syncMetadata(): void {
  draft.pack.title = $<HTMLInputElement>('#meta-title').value;
  draft.pack.author = $<HTMLInputElement>('#meta-author').value;
  draft.pack.description = $<HTMLTextAreaElement>('#meta-description').value;
  draft.pack.language = $<HTMLInputElement>('#meta-language').value.trim() || 'en';
  draft.pack.license = $<HTMLSelectElement>('#meta-license').value;
  draft.pack.tags = $<HTMLInputElement>('#meta-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean);
  draft.topic.title = draft.pack.title;
}

function fillMetadata(): void {
  $<HTMLInputElement>('#meta-title').value = draft.pack.title;
  $<HTMLInputElement>('#meta-author').value = draft.pack.author;
  $<HTMLTextAreaElement>('#meta-description').value = draft.pack.description;
  $<HTMLInputElement>('#meta-language').value = draft.pack.language;
  $<HTMLSelectElement>('#meta-license').value = draft.pack.license;
  $<HTMLInputElement>('#meta-tags').value = draft.pack.tags.join(', ');
  const note = draft.notes[0]?.chapters[0];
  $<HTMLInputElement>('#note-title').value = note?.title ?? '';
  $<HTMLTextAreaElement>('#note-text').value = note?.text ?? '';
}

function syncChapter(): void {
  const title = $<HTMLInputElement>('#note-title').value.trim();
  const text = $<HTMLTextAreaElement>('#note-text').value.trim();
  if (!title && !text) {
    draft.notes = [];
    return;
  }
  draft.notes = [{
    id: draft.notes[0]?.id ?? `${draft.pack.id}:note:guide`,
    title: draft.notes[0]?.title ?? `${draft.pack.title || 'Pack'} guide`,
    chapters: [{
      id: draft.notes[0]?.chapters[0]?.id ?? `${draft.pack.id}:chapter:guide`,
      title: title || 'Study guide', text,
    }],
  }];
}

function renderDraft(): void {
  $('#draft-title').textContent = draft.pack.title || 'Untitled pack';
  $('#draft-description').textContent = draft.pack.description || 'Your description will appear here.';
  $('#draft-version').textContent = `v${draft.pack.version}`;
  $('#draft-stats').textContent = packStats(draft);
  const cards = draft.sets.flatMap((set) => set.cards);
  $('#draft-cards').innerHTML = cards.length === 0
    ? '<div class="empty-draft"><span>Q</span><p>Your imported or new cards will appear here.</p></div>'
    : cards.slice(0, 100).map((card, index) => `<article class="draft-card"><small>CARD ${index + 1}</small><strong>${escapeHtml(card.q)}</strong><p>${escapeHtml(card.a)}</p><button class="remove-card" data-card-index="${index}" aria-label="Remove card ${index + 1}">×</button></article>`).join('') +
      (cards.length > 100 ? `<p class="studio-note">Showing the first 100 of ${cards.length} cards. The export includes every card.</p>` : '');
  document.querySelectorAll<HTMLButtonElement>('.remove-card').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.cardIndex);
      const card = cards[index];
      for (const set of draft.sets) set.cards = set.cards.filter((item) => item.id !== card.id);
      renderDraft();
    });
  });
}

function allEntries(): CatalogEntry[] {
  return [...localPacks, ...curated];
}

function renderCatalog(): void {
  const query = $<HTMLInputElement>('#catalog-search').value.trim().toLowerCase();
  const entries = allEntries().filter((entry) => {
    if (filter === 'local' && !entry.local) return false;
    if (filter === 'starter' && !entry.tags.includes('starter')) return false;
    return !query || [entry.title, entry.description, entry.author, ...entry.tags].join(' ').toLowerCase().includes(query);
  });
  const grid = $('#pack-grid');
  grid.innerHTML = entries.map((entry) => {
    const icon = entry.document?.topic.icon ?? (entry.tags.includes('science') ? '⚗' : entry.tags.includes('geography') ? '◎' : 'Q');
    return `<article class="pack-card"><div class="pack-art"><span class="pack-icon">${escapeHtml(icon)}</span><span class="pack-version ${entry.local ? 'local-badge' : ''}">${entry.local ? 'MY PACK' : `VERSION ${entry.version}`}</span></div><div class="pack-body"><div class="pack-tags">${entry.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div><h3>${escapeHtml(entry.title)}</h3><p>${escapeHtml(entry.description)}</p><div class="pack-meta"><span>${entry.cardCount} cards</span><span>${entry.chapterCount} chapters</span><span>${bytesLabel(entry.size)}</span></div><div class="pack-footer"><small>by ${escapeHtml(entry.author)}</small><button class="details-button" data-details="${escapeHtml(entry.id)}">Details</button><button class="button" data-download="${escapeHtml(entry.id)}">Download</button></div></div></article>`;
  }).join('');
  if (entries.length === 0) grid.innerHTML = '<div class="empty-draft"><span>Q</span><p>No packs match this search. Try another topic or create your own below.</p></div>';
  document.querySelectorAll<HTMLButtonElement>('[data-details]').forEach((button) => button.addEventListener('click', () => {
    const entry = allEntries().find((item) => item.id === button.dataset.details);
    if (entry) showDetails(entry);
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-download]').forEach((button) => button.addEventListener('click', () => {
    const entry = allEntries().find((item) => item.id === button.dataset.download);
    if (entry) void downloadEntry(entry, button);
  }));
}

async function downloadText(text: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadEntry(entry: CatalogEntry, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    if (entry.document) {
      await downloadText(serializePack(entry.document), `${entry.id}.quizpack`);
    } else {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error('The pack could not be downloaded.');
      const text = await response.text();
      validatePack(JSON.parse(text));
      if (entry.sha256 && await sha256(text) !== entry.sha256) throw new Error('The pack checksum does not match the catalog.');
      await downloadText(text, `${entry.id}.quizpack`);
    }
    button.textContent = 'Downloaded';
  } catch (error) {
    button.textContent = 'Try again';
    status($('#catalog-status'), error instanceof Error ? error.message : 'Download failed.', true);
  } finally {
    setTimeout(() => { button.disabled = false; button.textContent = 'Download'; }, 1800);
  }
}

function showDetails(entry: CatalogEntry): void {
  $('#dialog-content').innerHTML = `<span class="dialog-icon">${escapeHtml(entry.document?.topic.icon ?? 'Q')}</span><p class="eyebrow">${entry.local ? 'SAVED IN THIS BROWSER' : 'QUIZREADY STUDY PACK'}</p><h2>${escapeHtml(entry.title)}</h2><p class="dialog-description">${escapeHtml(entry.description)}</p><div class="dialog-facts"><div><small>DRILLS</small><strong>${entry.cardCount} cards</strong></div><div><small>STUDY</small><strong>${entry.chapterCount} chapters</strong></div><div><small>VERSION</small><strong>${entry.version} · ${bytesLabel(entry.size)}</strong></div><div><small>LANGUAGE</small><strong>${escapeHtml(entry.language.toUpperCase())}</strong></div></div><p class="dialog-license">${escapeHtml(entry.license)} · ${escapeHtml(entry.author)}</p><button class="button" id="dialog-download">Download .quizpack</button>${entry.local ? '<button class="details-button" id="delete-local">Remove from My packs</button>' : ''}`;
  $<HTMLButtonElement>('#dialog-download').addEventListener('click', (event) => void downloadEntry(entry, event.currentTarget as HTMLButtonElement));
  $('#delete-local')?.addEventListener('click', () => {
    localPacks = localPacks.filter((item) => item.id !== entry.id);
    persistLocal();
    renderCatalog();
    packDialog.close();
  });
  packDialog.showModal();
}

function persistLocal(): void {
  localStorage.setItem('quizready.myPacks', JSON.stringify(localPacks));
}

async function saveLocal(): Promise<void> {
  syncMetadata();
  syncChapter();
  preparePack(draft);
  const text = `${JSON.stringify(draft, null, 2)}\n`;
  const entry: CatalogEntry = {
    ...draft.pack, url: '', size: new Blob([text]).size, sha256: await sha256(text),
    cardCount: cardCount(draft), chapterCount: chapterCount(draft), local: true,
    document: JSON.parse(JSON.stringify(draft)) as StudyPack,
  };
  localPacks = localPacks.filter((item) => item.id !== entry.id);
  localPacks.unshift(entry);
  try {
    persistLocal();
  } catch {
    localPacks.shift();
    throw new Error('This pack is too large for browser storage. Download it instead.');
  }
  renderCatalog();
  status($('#studio-status'), 'Saved to My packs in this browser. Download a copy for safekeeping or sharing.');
}

async function importFile(file: File): Promise<void> {
  status($('#studio-status'), `Reading ${file.name}…`);
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  try {
    if (extension === 'quizpack') {
      draft = validatePack(JSON.parse(await file.text()));
      fillMetadata();
    } else if (extension === 'apkg') {
      const result = await importAnki(draft, file);
      fillMetadata();
      status($('#studio-status'), `Imported ${result.cards} cards and ${result.media} images. Review the pack before exporting.`);
    } else if (['txt', 'tsv', 'csv'].includes(extension)) {
      const count = importDelimited(draft, await file.text(), extension);
      if (!draft.pack.title) draft.pack.title = file.name.replace(/\.[^.]+$/, '');
      fillMetadata();
      status($('#studio-status'), `Imported ${count} question-and-answer cards.`);
    } else throw new Error('Choose an .apkg, .quizpack, .txt, .tsv, or .csv file.');
    renderDraft();
    if (extension === 'quizpack') status($('#studio-status'), `Loaded ${draft.pack.title}. You can edit, save, or export it.`);
  } catch (error) {
    status($('#studio-status'), error instanceof Error ? error.message : 'Could not import this file.', true);
  }
}

async function loadCatalog(): Promise<void> {
  try {
    const response = await fetch('catalog.json');
    if (!response.ok) throw new Error('The curated catalog is unavailable right now.');
    const catalog = await response.json() as Catalog;
    if (catalog.kind !== 'quizready-pack-catalog' || catalog.formatVersion !== 1) throw new Error('The catalog format is not supported.');
    curated = catalog.packs;
  } catch (error) {
    catalogError = error instanceof Error ? error.message : 'Could not load the catalog.';
  }
  status($('#catalog-status'), catalogError, Boolean(catalogError));
  renderCatalog();
}

for (const selector of ['#meta-title', '#meta-author', '#meta-description', '#meta-language', '#meta-license', '#meta-tags', '#note-title', '#note-text']) {
  $(selector).addEventListener('input', () => { syncMetadata(); syncChapter(); renderDraft(); });
}
$('#add-card').addEventListener('click', () => {
  const q = $<HTMLInputElement>('#new-question').value.trim();
  const a = $<HTMLInputElement>('#new-answer').value.trim();
  if (!q || !a) {
    status($('#studio-status'), 'A card needs both a question and an answer.', true);
    return;
  }
  const card: PackCard = {
    id: `${draft.pack.id}:card:${Date.now()}`, q, a,
    hint: $<HTMLInputElement>('#new-hint').value.trim(),
    accept: $<HTMLInputElement>('#new-accept').value.trim(),
  };
  draft.sets[0].cards.push(card);
  for (const id of ['#new-question', '#new-answer', '#new-hint', '#new-accept']) $<HTMLInputElement>(id).value = '';
  status($('#studio-status'), 'Card added.');
  renderDraft();
});
$('#choose-file').addEventListener('click', () => $<HTMLInputElement>('#file-input').click());
$('#dropzone').addEventListener('click', (event) => {
  if (event.target !== $('#choose-file')) $<HTMLInputElement>('#file-input').click();
});
$('#dropzone').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') $<HTMLInputElement>('#file-input').click();
});
$('#file-input').addEventListener('change', () => {
  const file = $<HTMLInputElement>('#file-input').files?.[0];
  if (file) void importFile(file);
  $<HTMLInputElement>('#file-input').value = '';
});
for (const eventName of ['dragenter', 'dragover']) $('#dropzone').addEventListener(eventName, (event) => {
  event.preventDefault();
  $('#dropzone').classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) $('#dropzone').addEventListener(eventName, (event) => {
  event.preventDefault();
  $('#dropzone').classList.remove('dragging');
});
$('#dropzone').addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files[0];
  if (file) void importFile(file);
});
$('#download-pack').addEventListener('click', () => {
  try {
    syncMetadata(); syncChapter(); downloadPack(draft); renderDraft(); fillMetadata();
    status($('#studio-status'), 'Pack downloaded. Open it in QuizReady to install the study notes and drills.');
  } catch (error) { status($('#studio-status'), error instanceof Error ? error.message : 'Could not export.', true); }
});
$('#save-pack').addEventListener('click', () => {
  void saveLocal().catch((error) => status($('#studio-status'), error instanceof Error ? error.message : 'Could not save.', true));
});
$('#reset-studio').addEventListener('click', () => {
  if (cardCount(draft) > 0 && !window.confirm('Clear this Pack Studio draft? Download it first if you want to keep it.')) return;
  draft = emptyPack();
  fillMetadata(); renderDraft(); status($('#studio-status'), 'Started a fresh pack.');
});
$('#catalog-search').addEventListener('input', renderCatalog);
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.filter ?? 'all';
  document.querySelectorAll('[data-filter]').forEach((chip) => chip.classList.toggle('active', chip === button));
  renderCatalog();
}));
$('#close-dialog').addEventListener('click', () => packDialog.close());
packDialog.addEventListener('click', (event) => {
  if (event.target === packDialog) packDialog.close();
});

fillMetadata();
renderDraft();
renderCatalog();
void loadCatalog();
