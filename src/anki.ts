import { unzipSync, strFromU8 } from 'fflate';
import initSqlJs from 'sql.js';
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url';
import { PackCard, StudyPack } from './types';

interface NoteRow {
  guid: string;
  fields: string[];
  tags: string[];
  modelId: string;
}

interface AnkiModel {
  flds?: { name: string }[];
  type?: number;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function text(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:div|p|li)>/gi, '\n');
  const parsed = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (parsed.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function imageName(source: string, mapped: string): string {
  const original = source.split('/').pop()?.replace(/[^a-zA-Z0-9_.-]/g, '-') || 'image';
  const prefix = mapped.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `img/${prefix}-${original}`;
}

export async function importAnki(document: StudyPack, file: File): Promise<{ cards: number; media: number }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('This .apkg could not be unzipped. Export the deck from Anki as text instead.');
  }
  const collection = files['collection.anki2'] ?? files['collection.anki21'];
  if (!collection) {
    throw new Error('This deck uses a newer compressed Anki collection. Export it from Anki as text instead.');
  }
  const SQL = await initSqlJs({ locateFile: () => sqlWasm });
  const database = new SQL.Database(collection);
  try {
    const modelsResult = database.exec('SELECT models FROM col LIMIT 1');
    const models = modelsResult[0]?.values[0]?.[0]
      ? JSON.parse(String(modelsResult[0].values[0][0])) as Record<string, AnkiModel> : {};
    const result = database.exec('SELECT guid, flds, mid, tags FROM notes');
    const notes: NoteRow[] = (result[0]?.values ?? []).map((row) => ({
      guid: String(row[0]), fields: String(row[1]).split('\x1f'),
      modelId: String(row[2]), tags: String(row[3]).trim().split(/\s+/).filter(Boolean),
    }));
    const mediaMap = files.media ? JSON.parse(strFromU8(files.media)) as Record<string, string> : {};
    const importedMedia = new Set<string>();
    const cards: PackCard[] = [];
    for (const note of notes) {
      const model = models[note.modelId];
      const names = model?.flds?.map((field) => field.name.toLowerCase()) ?? [];
      let front = names.findIndex((name) => /front|question|prompt/.test(name));
      let back = names.findIndex((name) => /back|answer|response/.test(name));
      if (front < 0) front = note.fields.findIndex((field) => field.trim());
      if (back < 0) back = note.fields.findIndex((field, index) => index !== front && field.trim());
      if (front < 0) continue;
      const frontHtml = note.fields[front] ?? '';
      const backHtml = back >= 0 ? note.fields[back] ?? '' : '';
      const cloze = /{{c\d+::/i.test(frontHtml);
      let question = '';
      let answer = '';
      if (cloze) {
        const answers: string[] = [];
        question = frontHtml.replace(/{{c\d+::(.*?)(?:::(.*?))?}}/gi, (_match, value: string, hint: string | undefined) => {
          answers.push(text(value));
          return hint ? `[${text(hint)}]` : '[…]';
        });
        answer = [...new Set(answers)].join('\n');
      } else {
        question = text(frontHtml);
        answer = text(backHtml);
      }
      const extras = note.fields.filter((_field, index) => index !== front && index !== back)
        .map((field) => text(field)).filter(Boolean);
      if (!cloze && extras.length) answer = [answer, ...extras].filter(Boolean).join('\n\n');
      const card: PackCard = {
        id: `anki:${note.guid}`, q: text(question), a: answer,
        tags: note.tags,
      };
      if (!card.q || !card.a) continue;
      const extractImage = (html: string): string | undefined => {
        const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
        if (!match) return undefined;
        const source = match[1].replace(/&amp;/g, '&');
        const mapped = mediaMap[source] ?? source;
        const bytes = files[mapped];
        if (!bytes) return undefined;
        const name = imageName(source, mapped);
        document.media[name] = base64(bytes);
        importedMedia.add(name);
        return name;
      };
      card.img = extractImage(frontHtml);
      card.imgReveal = extractImage(backHtml);
      cards.push(card);
    }
    if (cards.length === 0) throw new Error('No basic or cloze question/answer cards were found in this deck.');
    document.sets[0].cards.push(...cards);
    if (!document.pack.title) document.pack.title = file.name.replace(/\.apkg$/i, '');
    document.pack.tags = [...new Set([...document.pack.tags, 'anki'])];
    return { cards: cards.length, media: importedMedia.size };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('No basic') || error.message.includes('Anki'))) throw error;
    throw new Error('The Anki collection could not be read. Try Anki’s plain-text export instead.');
  } finally {
    database.close();
  }
}
