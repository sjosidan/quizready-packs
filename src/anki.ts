import { unzipSync, strFromU8 } from 'fflate';
import initSqlJs from 'sql.js';
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url';
import { PackCard, PackSet, StudyPack } from './types';

interface NoteRow {
  id: string;
  guid: string;
  fields: string[];
  tags: string[];
  modelId: string;
}

interface AnkiTemplate {
  name: string;
  qfmt: string;
  afmt: string;
  ord: number;
}

interface AnkiModel {
  flds?: { name: string }[];
  tmpls?: AnkiTemplate[];
  type?: number;
}

interface CardRow {
  id: string;
  noteId: string;
  ord: number;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function text(html: string): string {
  const withoutSound = html.replace(/\[sound:[^\]]+\]/gi, '');
  const withBreaks = withoutSound.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:div|p|li)>/gi, '\n');
  const parsed = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (parsed.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function mediaName(kind: string, source: string, mapped: string): string {
  const original = source.split('/').pop()?.replace(/[^a-zA-Z0-9_.-]/g, '-') || 'media';
  const prefix = mapped.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${kind}/${prefix}-${original}`;
}

function renderTemplate(template: string, fields: string[], names: string[]): string {
  let rendered = template.replace(/{{FrontSide}}/gi, '').replace(/<hr[^>]*id=["']?answer["']?[^>]*>/gi, '');
  rendered = rendered.replace(/{{#([^}]+)}}([\s\S]*?){{\/\1}}/gi, (_match, name: string, content: string) => {
    const index = names.findIndex((field) => field.toLowerCase() === name.toLowerCase());
    return index >= 0 && fields[index]?.trim() ? content : '';
  });
  return rendered.replace(/{{(?:cloze:)?([^}]+)}}/gi, (_match, name: string) => {
    const index = names.findIndex((field) => field.toLowerCase() === name.toLowerCase());
    return index >= 0 ? fields[index] ?? '' : '';
  });
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
    const result = database.exec('SELECT id, guid, flds, mid, tags FROM notes');
    const notes: NoteRow[] = (result[0]?.values ?? []).map((row) => ({
      id: String(row[0]), guid: String(row[1]), fields: String(row[2]).split('\x1f'),
      modelId: String(row[3]), tags: String(row[4]).trim().split(/\s+/).filter(Boolean),
    }));
    const noteById = new Map(notes.map((note) => [note.id, note]));
    const mediaMap = files.media ? JSON.parse(strFromU8(files.media)) as Record<string, string> : {};
    const importedMedia = new Set<string>();
    const mediaBytes = (source: string): { bytes: Uint8Array; mapped: string } | null => {
      let mapped = mediaMap[source];
      if (mapped === undefined) mapped = Object.keys(mediaMap).find((key) => mediaMap[key] === source) ?? source;
      const bytes = files[mapped] ?? files[source];
      return bytes ? { bytes, mapped } : null;
    };
    const extractMedia = (html: string, kind: 'img' | 'audio'): string | undefined => {
      const match = kind === 'img'
        ? /<img[^>]+src=["']([^"']+)["']/i.exec(html)
        : /\[sound:([^\]]+)\]/i.exec(html);
      if (!match) return undefined;
      const source = match[1].replace(/&amp;/g, '&');
      const media = mediaBytes(source);
      if (!media) return undefined;
      const name = mediaName(kind, source, media.mapped);
      document.media[name] = base64(media.bytes);
      importedMedia.add(name);
      return name;
    };
    const makeCard = (id: string, questionHtml: string, answerHtml: string, tags: string[]): PackCard | null => {
      const cloze = /{{c\d+::/i.test(questionHtml);
      let answer = text(answerHtml);
      let renderedQuestion = questionHtml;
      if (cloze) {
        const answers: string[] = [];
        renderedQuestion = questionHtml.replace(/{{c\d+::(.*?)(?:::(.*?))?}}/gi, (_match, value: string, hint: string | undefined) => {
          answers.push(text(value));
          return hint ? `[${text(hint)}]` : '[…]';
        });
        answer = [...new Set([...answers, answer].filter(Boolean))].join('\n');
      }
      const card: PackCard = { id, q: text(renderedQuestion), a: answer, tags };
      if (!card.q || !card.a) return null;
      card.img = extractMedia(questionHtml, 'img');
      card.imgReveal = extractMedia(answerHtml, 'img');
      card.audio = extractMedia(questionHtml, 'audio');
      card.audioReveal = extractMedia(answerHtml, 'audio');
      return card;
    };

    const cardResult = database.exec('SELECT id, nid, ord FROM cards ORDER BY id');
    const cardRows: CardRow[] = (cardResult[0]?.values ?? []).map((row) => ({
      id: String(row[0]), noteId: String(row[1]), ord: Number(row[2]),
    }));
    const sets = new Map<string, PackSet>();
    const cards: PackCard[] = [];
    for (const row of cardRows) {
      const note = noteById.get(row.noteId);
      if (!note) continue;
      const model = models[note.modelId];
      const names = model?.flds?.map((field) => field.name) ?? [];
      const template = model?.tmpls?.[row.ord];
      let questionHtml = '';
      let answerHtml = '';
      if (template) {
        questionHtml = renderTemplate(template.qfmt, note.fields, names);
        answerHtml = renderTemplate(template.afmt, note.fields, names);
      } else {
        const lowerNames = names.map((name) => name.toLowerCase());
        const front = Math.max(0, lowerNames.findIndex((name) => /front|question|prompt/.test(name)));
        const back = Math.max(1, lowerNames.findIndex((name) => /back|answer|response/.test(name)));
        questionHtml = note.fields[front] ?? '';
        answerHtml = note.fields[back] ?? '';
      }
      const card = makeCard(`anki:card:${row.id}`, questionHtml, answerHtml, note.tags);
      if (!card) continue;
      cards.push(card);
      const key = template ? `${document.pack.id}:template:${template.ord}` : `${document.pack.id}:drills`;
      const title = template?.name || 'Drills';
      if (!sets.has(key)) sets.set(key, { id: key, title, cards: [], tags: ['anki'] });
      sets.get(key)!.cards.push(card);
    }
    if (cardRows.length === 0) {
      for (const note of notes) {
        const model = models[note.modelId];
        const names = model?.flds?.map((field) => field.name) ?? [];
        const lowerNames = names.map((name) => name.toLowerCase());
        const front = Math.max(0, lowerNames.findIndex((name) => /front|question|prompt/.test(name)));
        const back = Math.max(1, lowerNames.findIndex((name) => /back|answer|response/.test(name)));
        const questionHtml = note.fields[front] ?? '';
        const answerHtml = note.fields[back] ?? '';
        const extras = note.fields.filter((_field, index) => index !== front && index !== back)
          .map((field) => text(field)).filter(Boolean);
        const card = makeCard(`anki:${note.guid}`, questionHtml,
          [answerHtml, ...extras].filter(Boolean).join('\n\n'), note.tags);
        if (card) cards.push(card);
      }
      document.sets[0].cards.push(...cards);
    } else {
      document.sets = [...sets.values()];
    }
    if (cards.length === 0) throw new Error('No basic or cloze question/answer cards were found in this deck.');
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
