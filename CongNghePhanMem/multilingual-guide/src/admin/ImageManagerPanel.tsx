import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiFetch } from '../services/api';
import { C } from '../theme/colors';
import PlaceImage, { type ImageLoadStatus } from '../components/PlaceImage';
import { PrimaryButton } from '../components/auth';
import PlaceImageEditor from './PlaceImageEditor';
import { useI18n } from '../hooks/useI18n';
type Row={id:number;name:string;category:string|null;address:string|null;image_url:string|null;image_thumbnail_url:string|null;images:Record<string,number>};
export default function ImageManagerPanel({token}:{token:string}) {
  const {t}=useI18n();
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[missing,setMissing]=useState(false),[page,setPage]=useState(1);
  const [data,setData]=useState<{items:Row[];total:number;pages:number}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [selected,setSelected]=useState<Row|null>(null),[dirty,setDirty]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setPage(1);},300);return()=>clearTimeout(timer);},[query]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');try{
      const result=await apiFetch<{items:Row[];total:number;pages:number}>(`/admin/images/places?${new URLSearchParams({q:search,missing:String(missing),page:String(page),page_size:'18'})}`,{token,signal});
      if(!signal?.aborted)setData(result);
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Chưa tải được thư viện ảnh.');}finally{if(!signal?.aborted)setLoading(false);}
  },[token,search,missing,page]);
  useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>void load(controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[load]);
  const index=data?.items.findIndex(row=>row.id===selected?.id)??-1;
  return <View style={{gap:18}} testID="image-manager">
    <View style={s.card}><Text style={s.title}>{t('Thư viện ảnh địa danh')}</Text><Text style={s.muted}>{t('Chọn địa danh để thêm, thay hoặc gỡ ảnh. Kiểm tra nguồn và giấy phép trước khi sử dụng.')}</Text><View style={s.row}><TextInput accessibilityLabel="Tìm địa danh trong thư viện ảnh" placeholder={t('Tìm tên địa danh')} value={query} onChangeText={setQuery} style={[s.input,{flex:1,minWidth:160}]}/><Pressable accessibilityRole="checkbox" aria-checked={missing} accessibilityState={{checked:missing}} onPress={()=>{setMissing(!missing);setPage(1);}} style={s.filter}><Text>{missing?'☑':'☐'} {t('Địa danh chưa có ảnh bìa')}</Text></Pressable><PrimaryButton title={t('Làm mới thư viện')} onPress={()=>void load()} variant="outline"/></View></View>
    {!!error&&<Text accessibilityRole="alert" style={{color:C.danger}}>{t(error)}</Text>}{loading&&<ActivityIndicator color={C.primary}/>}
    {!!data&&<Text style={s.muted}>{data.total} {t('địa danh')} · {page}/{Math.max(1,data.pages)}</Text>}
    <Text style={s.muted}>{t('Bộ lọc chỉ tìm địa danh chưa có URL ảnh bìa. Trạng thái phản ánh ảnh xem trước trên mạng hiện tại, không xác minh ảnh gốc; hãy thử lại trước khi kết luận ảnh hỏng.')}</Text>
    <View style={s.grid}>{data?.items.map(row=><ImageTile key={row.id} row={row} onSelect={()=>{setDirty(false);setSelected(row);}}/>)}</View>
    {data&&!data.items.length&&!loading&&<View style={s.card}><Text>{t('Chưa có địa danh phù hợp với bộ lọc.')}</Text></View>}
    <View style={s.row}><PrimaryButton title="← Trước" disabled={page<=1} onPress={()=>setPage(page-1)} variant="outline"/><PrimaryButton title="Sau →" disabled={!data||page>=data.pages} onPress={()=>setPage(page+1)} variant="outline"/></View>
    <Modal visible={!!selected} transparent animationType="fade" onRequestClose={()=>{if(!dirty)setSelected(null);}}><View style={s.overlay}><View style={s.dialog}>
      <Text style={s.title}>{selected?.name}</Text><Text style={s.muted}>{t('Quản lý ảnh và thông tin nguồn, rồi chuyển sang địa danh tiếp theo.')}</Text>
      <ScrollView keyboardShouldPersistTaps="handled">{selected&&<PlaceImageEditor key={selected.id} placeId={selected.id} uri={selected.image_url??''} token={token} onDirtyChange={setDirty} onSaved={cover=>{setSelected(old=>old?{...old,image_url:cover.image_url,image_thumbnail_url:cover.image_thumbnail_url??null}:old);void load();}}/>}</ScrollView>
      {dirty&&<Text style={s.muted}>{t('Hoàn tất tải hoặc lưu các chỉnh sửa trước khi chuyển địa danh.')}</Text>}
      <View style={s.row}><PrimaryButton title="← POI trước" disabled={dirty||index<=0} onPress={()=>setSelected(data!.items[index-1])} variant="outline"/><PrimaryButton title="POI tiếp →" disabled={dirty||!data||index>=data.items.length-1} onPress={()=>setSelected(data!.items[index+1])} variant="outline"/><PrimaryButton title={t('Đóng thư viện ảnh')} disabled={dirty} onPress={()=>setSelected(null)} variant="outline"/></View>
    </View></View></Modal>
  </View>;
}

function ImageTile({row,onSelect}:{row:Row;onSelect:()=>void}) {
  const {t}=useI18n();
  const [status,setStatus]=useState<ImageLoadStatus>(row.image_url || row.image_thumbnail_url ? 'loading' : 'missing');
  const labels:Record<ImageLoadStatus,string>={missing:'Chưa có ảnh bìa',loading:'Đang tải ảnh xem trước',loaded:'Ảnh xem trước đã tải được',unavailable:'Chưa tải được ảnh xem trước; hãy thử lại'};
  return <View style={s.tile}>
    <PlaceImage uri={row.image_url??''} thumbnailUri={row.image_thumbnail_url} onStatusChange={setStatus} label={`${t('Ảnh địa điểm')}: ${row.name}`} style={{width:'100%',height:145,borderRadius:12}}/>
    <Text accessibilityLiveRegion="polite" style={s.muted}>{t(labels[status])}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Quản lý ảnh ${row.name}`} onPress={onSelect} style={{gap:9,minHeight:44}}>
      <Text style={s.name}>{row.name}</Text><Text style={s.muted}>{row.category??''} · {row.images.approved??0} {t('ảnh đang dùng')} · {row.images.pending??0} {t('ảnh chưa sử dụng')}</Text><Text numberOfLines={2} style={s.muted}>{row.address??''}</Text>
    </Pressable>
  </View>;
}
const s=StyleSheet.create({card:{padding:18,backgroundColor:'white',borderRadius:18,borderWidth:1,borderColor:C.border,gap:12},title:{fontSize:19,fontWeight:'700',color:C.darkBlue},muted:{fontSize:12,lineHeight:18,color:C.muted},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10},input:{borderWidth:1,borderColor:C.border,borderRadius:10,padding:12,color:C.ink},filter:{padding:12,backgroundColor:C.paper,borderRadius:10},grid:{flexDirection:'row',flexWrap:'wrap',gap:15},tile:{flexGrow:1,flexBasis:225,maxWidth:'100%',padding:12,gap:9,backgroundColor:'white',borderRadius:16,borderWidth:1,borderColor:C.border},name:{fontWeight:'700',color:C.darkBlue,fontSize:14},overlay:{flex:1,padding:16,backgroundColor:'rgba(9,28,35,.55)',alignItems:'center',justifyContent:'center'},dialog:{width:'100%',maxWidth:900,maxHeight:'94%',backgroundColor:'white',borderRadius:18,padding:18,gap:12}});
