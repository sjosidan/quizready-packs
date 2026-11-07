import { PackCard, StudyPack, cardCount, chapterCount, slug, validatePack } from './types';

export function emptyPack(): StudyPack {
  const now = new Date().toISOString();
  return {
    kind: 'quizready-study-pack',
    formatVersion: 1,
    pack: {
      id: 'my-pack', title: '', description: '', author: '', version: 1,
      language: 'en', tags: [], license: 'CC0-1.0', minAppVersion: 1, updated: now,
    },
    topic: { id: 'pack-my-pack', title: '', icon: '📚', color: '#FFB800', tags: [] },
    sets: [{ id: 'my-pack:drills', title: 'Drills', cards: [], tags: [] }],
    notes: [], media: {},
  };
}

export function preparePack(document: StudyPack): StudyPack {
  const title = document.pack.title.trim();
  if (!title) throw new Error('Give your pack a title first.');
  if (!document.pack.author.trim()) throw new Error('Add an author or creator name.');
  if (cardCount(document) === 0) throw new Error('Add or import at least one drill card.');
  const id = document.pack.id === 'my-pack' || !document.pack.id ? slug(title) : document.pack.id;
  document.pack.id = id;
  document.pack.updated = new Date().toISOString();
  document.pack.tags = document.pack.tags.map((tag) => tag.trim()).filter(Boolean);
  document.topic.id = document.topic.id === 'pack-my-pack' ? `pack-${id}` : document.topic.id;
  document.topic.title = title;
  document.topic.tags = document.pack.tags;
  for (const set of document.sets) {
    if (set.id === 'my-pack:drills') set.id = `${id}:drills`;
    else if (set.id.startsWith('my-pack:template:')) set.id = set.id.replace('my-pack:', `${id}:`);
    if (!set.title) set.title = `${title} drills`;
  }
  return validatePack(document);
}

export function serializePack(document: StudyPack): string {
  return `${JSON.stringify(preparePack(document), null, 2)}\n`;
}

export function downloadPack(document: StudyPack): void {
  const text = serializePack(document);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = `${document.pack.id}.quizpack`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function importDelimited(document: StudyPack, text: string, extension: string): number {
  const delimiter = extension === 'csv' ? ',' : '\t';
  const rows = parseDelimited(text.replace(/^﻿/, ''), delimiter);
  const cards = rows.filter((row) => row.length >= 2 && row[0].trim() && row[1].trim()).map((row, index) => ({
    id: `${document.pack.id || 'import'}:card:${Date.now()}-${index}`,
    q: row[0].trim(), a: row[1].trim(), tags: row[2]?.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean) ?? [],
  } as PackCard));
  if (cards.length === 0) throw new Error('No question/answer rows were found. Use two columns separated by tabs or commas.');
  document.sets[0].cards.push(...cards);
  return cards.length;
}

export async function checksumPack(document: StudyPack): Promise<{ text: string; sha256: string }> {
  const text = serializePack(document);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return { text, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') };
}

export function packStats(document: StudyPack): string {
  return `${cardCount(document)} cards · ${chapterCount(document)} study chapters · ${Object.keys(document.media).length} media files`;
}
