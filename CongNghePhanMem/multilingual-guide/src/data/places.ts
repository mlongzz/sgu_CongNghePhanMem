export type Language = 'vi' | 'en' | 'fr' | 'ja';
export type Category = 'Lịch sử' | 'Kiến trúc' | 'Văn hóa' | 'Khám phá';
export type Translated = Record<Language, string>;
export type NarrationContent = {
  text: string;
  language: Language;
  title?: string;
  source: 'published' | 'saved' | 'wikipedia' | 'description';
  sourceUrl?: string;
  licenseUrl?: string;
  attribution?: string;
};
export type Place = {
  id: string; title: string; subtitle: Translated; description: Translated;
  category: Category; district: string; latitude: number; longitude: number;
  image: string; duration: number; rating: number; source?: "osm" | "backend" | "demo" | "wikipedia" | "wikidata";
  sourceUrl?: string;
  sourceLicense?: string;
  imageSourceUrl?: string;
  imageAttribution?: string;
  imageLicense?: string;
  publicationStatus?: 'draft' | 'published';
  narration?: Partial<Record<Language, NarrationContent>>;
  wikipedia?: { language: Language; pageId?: number; title?: string };
  wikipediaUrl?: string;
};

export const LANGS: {key: Language; label: string; voice: string; flag: string}[] = [
  { key: 'vi', label: 'Tiếng Việt', voice: 'vi-VN', flag: '🇻🇳' },
  { key: 'en', label: 'English', voice: 'en-US', flag: '🇬🇧' },
  { key: 'fr', label: 'Français', voice: 'fr-FR', flag: '🇫🇷' },
  { key: 'ja', label: '日本語', voice: 'ja-JP', flag: '🇯🇵' },
];

