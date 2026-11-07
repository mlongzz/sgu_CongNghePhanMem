import type { Category, Language, Place } from '../data/places';
import { distanceKm, type Coordinates } from './nearby';
import { WALKING_DETOUR, WALKING_SPEED_KMH } from './optimalRoute';

/** Compass bearing in degrees (0 = north) from a to b. */
export function bearing(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.longitude - a.longitude) * rad) * Math.cos(b.latitude * rad);
  const x = Math.cos(a.latitude * rad) * Math.sin(b.latitude * rad) - Math.sin(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.cos((b.longitude - a.longitude) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const DIRECTIONS: Record<Language, string[]> = {
  vi: ['bắc', 'đông bắc', 'đông', 'đông nam', 'nam', 'tây nam', 'tây', 'tây bắc'],
  en: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
  fr: ['le nord', 'le nord-est', 'l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest'],
  ja: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'],
};
export function direction(a: Coordinates, b: Coordinates, language: Language): string {
  return DIRECTIONS[language][Math.round(bearing(a, b) / 45) % 8];
}

/** Walking estimate: rounded metres under 1 km, otherwise km with one decimal; minutes at least 1. */
export function walk(a: Coordinates, b: Coordinates, language: Language): { distance: string; minutes: number } {
  const km = distanceKm(a, b) * WALKING_DETOUR;
  const minutes = Math.max(1, Math.round((km / WALKING_SPEED_KMH) * 60));
  if (km < 1) {
    const metres = Math.max(50, Math.round((km * 1000) / 50) * 50);
    return { distance: language === 'ja' ? `約${metres}メートル` : language === 'vi' ? `khoảng ${metres} mét` : language === 'fr' ? `environ ${metres} mètres` : `about ${metres} metres`, minutes };
  }
  const value = km.toFixed(1);
  return { distance: language === 'ja' ? `約${value}キロ` : language === 'vi' ? `khoảng ${value.replace('.', ',')} ki-lô-mét` : language === 'fr' ? `environ ${value.replace('.', ',')} kilomètres` : `about ${value} kilometres`, minutes };
}

const THEME: Record<Language, Record<Category, string>> = {
  vi: { 'Lịch sử': 'lịch sử', 'Kiến trúc': 'kiến trúc', 'Văn hóa': 'văn hóa', 'Khám phá': 'khám phá thiên nhiên và đời sống' },
  en: { 'Lịch sử': 'history', 'Kiến trúc': 'architecture', 'Văn hóa': 'culture', 'Khám phá': 'city life and green spaces' },
  fr: { 'Lịch sử': 'l’histoire', 'Kiến trúc': 'l’architecture', 'Văn hóa': 'la culture', 'Khám phá': 'la vie urbaine et les espaces verts' },
  ja: { 'Lịch sử': '歴史', 'Kiến trúc': '建築', 'Văn hóa': '文化', 'Khám phá': '街の暮らしと緑' },
};

const list = (names: string[], language: Language) => {
  if (names.length <= 1) return names.join('');
  if (language === 'ja') return names.join('、');
  const last = names[names.length - 1];
  const and = language === 'vi' ? ' và ' : language === 'fr' ? ' et ' : ' and ';
  return names.slice(0, -1).join(', ') + and + last;
};

/** Welcome: how many stops, which ones, the total walk, and where to head first. */
export function introScript(stops: Place[], start: Coordinates, totalKm: number, totalMinutes: number, language: Language): string {
  const names = stops.map(p => p.title);
  const first = stops[0];
  const step = walk(start, first, language);
  const dir = direction(start, first, language);
  const km = totalKm.toFixed(1);
  switch (language) {
    case 'en': return `Welcome to your walking tour of District 1. Today we will visit ${stops.length} places: ${list(names, language)}. The whole walk is about ${km} kilometres, roughly ${totalMinutes} minutes on foot, not counting time at each stop. Our first stop is ${first.title}, ${step.distance} to the ${dir}, about ${step.minutes} minutes away. When you get there, confirm your arrival and I will begin the story.`;
    case 'fr': return `Bienvenue dans votre promenade guidée du 1er arrondissement. Aujourd’hui, nous visiterons ${stops.length} lieux : ${list(names, language)}. Le parcours fait environ ${km.replace('.', ',')} kilomètres, soit à peu près ${totalMinutes} minutes de marche, sans compter les visites. Première étape : ${first.title}, à ${step.distance} vers ${dir}, environ ${step.minutes} minutes. Une fois sur place, confirmez votre arrivée et je commencerai le récit.`;
    case 'ja': return `1区の徒歩ツアーへようこそ。今日は${list(names, language)}の${stops.length}か所を巡ります。全行程は約${km}キロ、歩いておよそ${totalMinutes}分です。見学時間は含みません。最初の目的地は${first.title}で、${dir}へ${step.distance}、徒歩約${step.minutes}分です。到着したら確認ボタンを押してください。案内を始めます。`;
    default: return `Chào mừng bạn đến với hành trình đi bộ khám phá Quận 1. Hôm nay chúng ta sẽ ghé ${stops.length} điểm: ${list(names, language)}. Cả chặng dài ${km.replace('.', ',')} ki-lô-mét, đi bộ khoảng ${totalMinutes} phút, chưa tính thời gian tham quan. Điểm dừng đầu tiên là ${first.title}, cách bạn ${step.distance} về hướng ${dir}, đi bộ chừng ${step.minutes} phút. Khi tới nơi, hãy xác nhận để tôi bắt đầu kể câu chuyện về địa điểm này.`;
  }
}

/** Bridge from one stop to the next: direction, distance, time and how the themes connect. */
export function transitionScript(from: Place, to: Place, index: number, total: number, language: Language): string {
  const step = walk(from, to, language);
  const dir = direction(from, to, language);
  const same = from.category === to.category;
  const fromTheme = THEME[language][from.category] ?? THEME[language]['Khám phá'];
  const toTheme = THEME[language][to.category] ?? THEME[language]['Khám phá'];
  const last = index === total - 1;
  switch (language) {
    case 'en': {
      const bridge = same ? `We stay with the theme of ${toTheme}.` : `We move from ${fromTheme} to ${toTheme}.`;
      return `That was ${from.title}. ${bridge} ${last ? 'Our final stop' : `Stop ${index + 1} of ${total}`} is ${to.title}, ${step.distance} to the ${dir}, about ${step.minutes} minutes on foot. Take your time on the way, and confirm when you arrive.`;
    }
    case 'fr': {
      const bridge = same ? `Nous restons dans le thème de ${toTheme}.` : `Nous passons de ${fromTheme} à ${toTheme}.`;
      return `Voilà pour ${from.title}. ${bridge} ${last ? 'Notre dernière étape' : `L’étape ${index + 1} sur ${total}`} est ${to.title}, à ${step.distance} vers ${dir}, environ ${step.minutes} minutes à pied. Prenez votre temps et confirmez votre arrivée.`;
    }
    case 'ja': {
      const bridge = same ? `引き続き${toTheme}をテーマに巡ります。` : `${fromTheme}から${toTheme}へとテーマが移ります。`;
      return `${from.title}の案内はここまでです。${bridge}${last ? '最後の目的地' : `${total}か所中${index + 1}番目の目的地`}は${to.title}です。${dir}へ${step.distance}、徒歩約${step.minutes}分です。到着したら確認してください。`;
    }
    default: {
      const bridge = same ? `Chúng ta tiếp tục mạch câu chuyện về ${toTheme}.` : `Từ ${fromTheme}, chúng ta chuyển sang chủ đề ${toTheme}.`;
      return `Vậy là chúng ta vừa tìm hiểu ${from.title}. ${bridge} ${last ? 'Điểm dừng cuối cùng' : `Điểm dừng thứ ${index + 1} trên ${total}`} là ${to.title}, cách đây ${step.distance} về hướng ${dir}, đi bộ chừng ${step.minutes} phút. Bạn cứ thong thả, tới nơi thì xác nhận để nghe tiếp nhé.`;
    }
  }
}

export function closingScript(visited: number, total: number, language: Language): string {
  switch (language) {
    case 'en': return `Our tour ends here. You have visited ${visited} of ${total} places in District 1. Thank you for walking with us, and enjoy the rest of your day in Saigon.`;
    case 'fr': return `Notre visite s’achève ici. Vous avez découvert ${visited} lieux sur ${total} du 1er arrondissement. Merci de nous avoir accompagnés, et belle fin de journée à Saïgon.`;
    case 'ja': return `ツアーはここで終わりです。1区の${total}か所のうち${visited}か所を訪れました。ご一緒いただきありがとうございました。サイゴンでの残りの時間をお楽しみください。`;
    default: return `Hành trình của chúng ta đến đây là kết thúc. Bạn đã ghé ${visited} trên ${total} điểm của Quận 1. Cảm ơn bạn đã đồng hành, chúc bạn có thêm nhiều trải nghiệm đẹp ở Sài Gòn.`;
  }
}
