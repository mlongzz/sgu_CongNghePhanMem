import type { Category, Place } from '../data/places';
import { isInDistrict1 } from '../data/district1';

/** Lowercase, strip Vietnamese diacritics and punctuation so keywords match any spelling. */
function norm(value: string): string {
  return ` ${value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9()]+/g, ' ')
    .trim()} `;
}

type Rule = { re: RegExp; category: Category };

// Order matters: the first match decides the category shown on the card.
const TOURIST_RULES: Rule[] = [
  // Lịch sử
  { re: / (bao tang|nha trung bay|khu di tich|di tich|dia dao|can cu|tuong dai|dai tuong niem|nghia trang liet si|lang (mo|tam)|hoang cung|co do|thanh co|dinh (doc lap|thong nhat|norodom|xa tay|gia long))\b/, category: 'Lịch sử' },
  { re: / (museum|memorial|monument|mausoleum|tunnels?|citadel|fort|war remnants|heritage site)\b/, category: 'Lịch sử' },
  // Văn hóa
  { re: /^ (chua|den|dinh|mieu|am|phu|tinh xa|thien vien|tu vien|van mieu|hoi quan|thanh that|giao duong|thanh duong hoi giao) /, category: 'Văn hóa' },
  { re: / (chua|hoi quan|thanh that|van mieu) /, category: 'Văn hóa' },
  { re: /^ (cho|nha hat|nha van hoa|cung van hoa|pho di bo|pho (sach|tay|am thuc)|khu pho) /, category: 'Văn hóa' },
  { re: / (pagoda|temple|shrine|mosque|market|opera house|theatre|theater|assembly hall|walking street)\b/, category: 'Văn hóa' },
  // Kiến trúc
  { re: /^ (nha tho|thanh duong|giao xu|tu vien|buu dien|thap|cau|toa nha|toa thi chinh|lau dai|biet dien|dinh thu|nha co|cot co) /, category: 'Kiến trúc' },
  { re: / (nha tho|buu dien trung tam|landmark 81|bitexco|tower|cathedral|basilica|church|post office|bridge|palace|castle|city hall|opera)\b/, category: 'Kiến trúc' },
  // Khám phá
  { re: /^ (cong vien|vuon|thao cam vien|quang truong|cong truong|ho|dao|bai bien|bai|thac|suoi|nui|deo|rung|vuon quoc gia|khu du lich|khu bao ton|khu vui choi|thuy cung|ben|mui|vinh|dong|hang|song (sai gon|huong)|hon) /, category: 'Khám phá' },
  { re: / (khu du lich|cong vien|dam sen|suoi tien|thao cam vien|landmark)\b/, category: 'Khám phá' },
  { re: / (park|garden|zoo|square|lake|beach|island|waterfall|falls|mountain|cave|bay|aquarium|viewpoint|national park|amusement)\b/, category: 'Khám phá' },
];

// Never a tourist destination even if a keyword above matches (administrative units, events, institutions…).
const EXCLUDE = [
  /^ (phuong|quan|xa|huyen|thi tran|thi xa|thanh pho|tinh|ap|khu pho \d) /,
  /\((phuong|quan|xa|huyen|thanh pho|tinh)\)/,
  /^ (su kien|vu|tran|chien dich|cuoc|le hoi|hoi nghi|dai hoi|chien tranh|bieu tinh|bao loan|dao chinh|thoa thuan|hiep dinh) /,
  /^ (truong|dai hoc|hoc vien|vien|benh vien|phong kham|toa an|vien kiem sat|uy ban|so|bo|cuc|tong cuc|tru so|cong ty|tap doan|ngan hang|khach san|nha nghi|duong|hem|ga|san bay|ben xe|tram|cang|nha may|xi nghiep|chung cu|can ho|cao oc(?! bitexco)|trung tam thuong mai|sieu thi|cua hang|nha hang|quan an|lanh su quan|dai su quan|tong lanh su quan|nhac vien|thu vien|nha xuat ban|bao(?! tang)|tap chi|dai truyen hinh|dai phat thanh|cau lac bo|san van dong|nha thi dau|ky tuc xa|co quan|dang bo|hoi dong|kenh|rach|song|tuyen|metro|xe buyt|giao lo|vong xoay|nut giao) /,
  / (school|university|college|hospital|court|embassy|consulate|company|bank|hotel|street|road|avenue|district|ward|station|airport|incident|fire|attack|battle|election|stadium|library|conservatory|office building) /,
];

/** Classify a Wikipedia article title: returns a category when it is a visitor attraction, otherwise null. */
export function classifyTouristTitle(title: string): Category | null {
  const n = norm(title);
  if (n.trim() === 'ho chi minh') return null;
  if (EXCLUDE.some(re => re.test(n))) return null;
  return TOURIST_RULES.find(rule => rule.re.test(n))?.category ?? null;
}

/**
 * Admin-curated places and OpenStreetMap POIs (queried only with tourism/historic/park tags)
 * are attractions by construction; Wikipedia geosearch returns any article with coordinates,
 * so it is classified from the title.
 */
export function isTouristPlace(place: Place): boolean {
  if (place.source !== 'wikipedia') return true;
  return classifyTouristTitle(place.title) !== null;
}

/** Give Wikipedia attractions a meaningful category so the category chips work for them too. */
export function withTouristCategory(place: Place): Place {
  if (place.source !== 'wikipedia') return place;
  const category = classifyTouristTitle(place.title);
  return category && category !== place.category ? { ...place, category } : place;
}

export function hasPlaceImage(place: Pick<Place, 'image' | 'imageThumbnail'>): boolean {
  return Boolean(place.image?.trim() || place.imageThumbnail?.trim());
}

export type PlaceFilters = { touristOnly: boolean; withImageOnly: boolean; district1Only: boolean };
export const DEFAULT_PLACE_FILTERS: PlaceFilters = { touristOnly: true, withImageOnly: true, district1Only: true };

export function applyPlaceFilters(places: readonly Place[], filters: PlaceFilters): Place[] {
  return places.filter(place => (!filters.district1Only || isInDistrict1(place))
    && (!filters.touristOnly || isTouristPlace(place))
    && (!filters.withImageOnly || hasPlaceImage(place)));
}
