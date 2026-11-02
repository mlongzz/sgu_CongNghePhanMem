import { Linking, Pressable, Text, View } from 'react-native';
import type { Place } from '../data/places';
import {useI18n} from '../hooks/useI18n';
import { C } from '../theme/colors';
import { imageLicenseUrl } from '../services/imageCredits';
export default function ImageCredit({place}:{place:Pick<Place,'imageAttribution'|'imageLicense'|'imageSourceUrl'>}) {
  const {t,language}=useI18n();
  if (!place.imageAttribution && !place.imageLicense) return null;
  const license = imageLicenseUrl(place.imageLicense);
  const open=(url:string)=> { if (/^https?:\/\//.test(url)) void Linking.openURL(url).catch(()=>{}); };
  return <View style={{gap:3,marginTop:6}}><Text style={{fontSize:10,lineHeight:15,color:C.muted}}>{t('Nguồn ảnh')}: {[place.imageAttribution,place.imageLicense].filter(Boolean).join(' · ')}</Text>{language !== 'vi' && <Text style={{fontSize:10,lineHeight:15,color:C.muted}}>{t('Thông tin ghi công được giữ nguyên theo nguồn ảnh.')}</Text>}<View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{place.imageSourceUrl ? <Pressable accessibilityRole="link" onPress={e=>{e.stopPropagation();open(place.imageSourceUrl!);}}><Text style={{fontSize:10,lineHeight:16,color:C.primaryDark}}>{t('Nguồn ảnh')} ↗</Text></Pressable> : null}{place.imageLicense ? <Pressable accessibilityRole="link" disabled={!license} onPress={e=>{e.stopPropagation();if(license)open(license);}}><Text style={{fontSize:10,lineHeight:16,color:C.primaryDark}}>{place.imageLicense}{license ? ' ↗' : ''}</Text></Pressable> : null}</View></View>;
}
