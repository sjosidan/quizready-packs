export interface PackMeta {
  id: string;
  title: string;
  description: string;
  author: string;
  version: number;
  language: string;
  tags: string[];
  license: string;
  minAppVersion: number;
  updated: string;
}

export interface PackCard {
  id: string;
  q: string;
  a: string;
  accept?: string;
  hint?: string;
  tags?: string[];
  img?: string;
  imgReveal?: string;
}

export interface PackSet {
  id: string;
  title: string;
  tags?: string[];
  cards: PackCard[];
}

export interface PackChapter {
  id: string;
  title: string;
  text: string;
}

export interface PackNote {
  id: string;
  title: string;
  chapters: PackChapter[];
}

export interface StudyPack {
  kind: 'quizready-study-pack';
  formatVersion: 1;
  pack: PackMeta;
  topic: {
    id: string;
    title: string;
    icon: string;
    color: string;
    tags: string[];
    art?: string;
  };
  sets: PackSet[];
  notes: PackNote[];
  media: Record<string, string>;
}

export interface CatalogEntry extends PackMeta {
  url: string;
  size: number;
  sha256: string;
  cardCount: number;
  chapterCount: number;
  local?: boolean;
  document?: StudyPack;
}

export interface Catalog {
  kind: 'quizready-pack-catalog';
  formatVersion: 1;
  updated: string;
  packs: CatalogEntry[];
}

export function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled-pack';
}

export function cardCount(document: StudyPack): number {
  return document.sets.reduce((total, set) => total + set.cards.length, 0);
}

export function chapterCount(document: StudyPack): number {
  return document.notes.reduce((total, note) => total + note.chapters.length, 0);
}

export function validatePack(value: unknown): StudyPack {
  if (!value || typeof value !== 'object') throw new Error('This file is not a QuizReady pack.');
  const document = value as StudyPack;
  if (document.kind !== 'quizready-study-pack' || document.formatVersion !== 1) {
    throw new Error('Unsupported pack type or version.');
  }
  const meta = document.pack;
  if (!meta?.id || !meta.title || !meta.author || !Number.isInteger(meta.version) || meta.version < 1) {
    throw new Error('The pack is missing its ID, title, author, or version.');
  }
  if (!document.topic?.id || !document.topic.title || !Array.isArray(document.sets) || document.sets.length === 0) {
    throw new Error('The pack needs a topic and at least one drill set.');
  }
  const ids = new Set<string>();
  for (const set of document.sets) {
    if (!set.id || !set.title || !Array.isArray(set.cards) || set.cards.length === 0) {
      throw new Error('Every drill set needs an ID, title, and cards.');
    }
    for (const card of set.cards) {
      if (!card.id || ids.has(card.id)) throw new Error(`A card ID is missing or duplicated: ${card.id || 'unknown'}`);
      if (!card.q?.trim() || !card.a?.trim()) throw new Error(`Card ${card.id} needs a question and answer.`);
      ids.add(card.id);
    }
  }
  document.notes = Array.isArray(document.notes) ? document.notes : [];
  document.media = document.media && typeof document.media === 'object' ? document.media : {};
  for (const name of Object.keys(document.media)) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Unsafe media path: ${name}`);
  }
  return document;
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
