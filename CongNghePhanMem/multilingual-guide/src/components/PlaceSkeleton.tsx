import { View } from 'react-native';
import { C } from '../theme/colors';
export default function PlaceSkeleton({count=3}:{count?:number}) {
  return <View accessibilityRole="progressbar" accessibilityLabel="Đang tải địa điểm" style={{gap:12}}>{Array.from({length:count},(_,i)=><View key={i} style={{borderRadius:18,borderWidth:1,borderColor:C.border,backgroundColor:C.white,overflow:'hidden'}}><View style={{height:120,backgroundColor:'#E5EEEF'}}/><View style={{padding:16,gap:10}}><View style={{width:'35%',height:10,borderRadius:5,backgroundColor:'#E5EEEF'}}/><View style={{width:'76%',height:18,borderRadius:6,backgroundColor:'#E5EEEF'}}/><View style={{width:'95%',height:12,borderRadius:5,backgroundColor:'#EEF3F4'}}/></View></View>)}</View>;
}
