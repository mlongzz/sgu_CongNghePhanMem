import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ApiError, apiFetch } from '../services/api';
import PlaceImage, { mediaUrl } from '../components/PlaceImage';
import { PrimaryButton } from '../components/auth';
import { C } from '../theme/colors';
import { useI18n } from '../hooks/useI18n';
import ImageDropZone from './ImageDropZone';

type Cover={image_url:string|null;image_thumbnail_url:string|null;image_source_url:string|null;image_attribution:string|null;image_license:string|null};
type Candidate={id:number;url:string;thumbnail_url?:string|null;source_url:string|null;attribution:string|null;license:string|null;status:string;position:number;health_status?:string;health_error?:string|null};
type Suggestion={url:string;source_url:string;attribution:string;license:string;confidence:string;identity_matches_coordinates:boolean};
type Metadata={source_url:string;attribution:string;license:string;position:string};
type Pending={uri:string;blob:Blob};
export default function PlaceImageEditor({placeId,uri,token,onSaved,onDirtyChange}:{placeId:number;uri:string;token:string;onSaved:(cover:Cover)=>void;onDirtyChange?:(dirty:boolean)=>void}) {
  const {t}=useI18n();
  const [items,setItems]=useState<Candidate[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(false);
  const [queue,setQueue]=useState<Pending[]>([]),[edits,setEdits]=useState<Record<number,Metadata>>({});
  const [url,setUrl]=useState(''),[source,setSource]=useState(''),[author,setAuthor]=useState(''),[license,setLicense]=useState('');
  const [wikiId,setWikiId]=useState(''),[wikidataId,setWikidataId]=useState(''),[suggested,setSuggested]=useState<Suggestion[]>([]),[sourceName,setSourceName]=useState('');
  const objectUrls=useRef<string[]>([]);const mounted=useRef(true);const loadSeq=useRef(0);
  const uploadRequest=useRef<AbortController|null>(null);
  const [uploading,setUploading]=useState(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;uploadRequest.current?.abort();};},[]);
  useEffect(()=>()=>{if(Platform.OS==='web')for(const value of objectUrls.current)URL.revokeObjectURL(value);},[]);
  useEffect(()=>{onDirtyChange?.(busy||queue.length>0||Object.keys(edits).length>0||!!url);},[busy,queue.length,edits,url,onDirtyChange]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const sequence=++loadSeq.current;
    try{const rows=await apiFetch<Candidate[]>(`/admin/places/${placeId}/images`,{token,signal});if(!signal?.aborted&&mounted.current&&sequence===loadSeq.current)setItems(rows);}
    catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Chưa tải được thư viện ảnh.');}
  },[placeId,token]);
  useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>void load(controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[load]);
  const fail=(e:unknown)=>setError(e instanceof Error?e.message:'Không xử lý được ảnh. Vui lòng thử lại.');
  const addFiles=(files:Blob[])=>{
    if(queue.length+files.length>10){setError('Chọn tối đa 10 ảnh trong một lần.');return;}
    if(files.some(file=>file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))){setError('Chọn ảnh JPEG, PNG hoặc WebP tối đa 5 MB/ảnh.');return;}
    const entries=files.map(blob=>{const uri=URL.createObjectURL(blob);objectUrls.current.push(uri);return{uri,blob};});setQueue(old=>[...old,...entries]);setError('');
  };
  const choose=async()=>{
    if(busy)return;setBusy(true);setError('');
    try{
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:10,quality:.9});
      if(result.canceled)return;
      if(queue.length+result.assets.length>10)throw new Error('Chọn tối đa 10 ảnh trong một lần.');
      const next:Pending[]=[];
      for(const asset of result.assets){const blob=asset.file??await(await fetch(asset.uri)).blob();if(blob.size>5*1024*1024)throw new Error('Ảnh cần nhỏ hơn 5 MB.');next.push({blob,uri:asset.uri});}
      setQueue(old=>[...old,...next]);
    }catch(e){fail(e);}finally{setBusy(false);}
  };
  const upload=async()=>{
    if(uploadRequest.current||busy)return;
    const controller=new AbortController();uploadRequest.current=controller;
    setUploading(true);setBusy(true);setError('');let completed=0;
    try{
      for(const entry of queue){
        await apiFetch(`/admin/places/${placeId}/image`,{token,method:'POST',headers:{'Content-Type':entry.blob.type||'application/octet-stream'},body:entry.blob,timeoutMs:90_000,signal:controller.signal});
        completed++;setNotice(`Đã xử lý ${completed}/${queue.length} ảnh. Ảnh trùng được giữ một bản.`);
      }
      setNotice('Ảnh đã lưu vào thư viện. Xác nhận tác giả và giấy phép trước khi sử dụng.');
    }catch(e){if(mounted.current)fail(e);}finally{
      uploadRequest.current=null;
      if(mounted.current){setQueue(old=>old.slice(completed));await load();setBusy(false);setUploading(false);}
    }
  };
  const importUrl=async(candidate?:Suggestion)=>{
    setBusy(true);setError('');
    try{
      const payload=candidate?{url:candidate.url,source_url:candidate.source_url,attribution:candidate.attribution,license:candidate.license}:{url,source_url:source||null,attribution:author||null,license:license||null};
      const result=await apiFetch<{created:boolean}>(`/admin/places/${placeId}/images/url`,{token,method:'POST',body:JSON.stringify(payload)});
      setNotice(result.created?'Đã lưu ảnh vào thư viện.':'Ảnh này đã có trong thư viện, không tạo bản trùng.');
      if(!candidate){setUrl('');setSource('');setAuthor('');setLicense('');}await load();
    }catch(e){fail(e);}finally{setBusy(false);}
  };
  const discover=async(byName=false)=>{
    setBusy(true);setError('');
    try{
      if(wikiId&&!/^\d+$/.test(wikiId))throw new Error('Wikipedia page ID phải là số nguyên dương.');
      const result=await apiFetch<{items:Suggestion[];source_name?:string}>(`/admin/places/${placeId}/images/suggestions`,{token,method:'POST',body:JSON.stringify({...(wikiId?{wikipedia_page_id:Number(wikiId)}:{}),...(wikidataId?{wikidata_id:wikidataId.trim()}:{}),search_by_name:byName})});
      setSuggested(result.items);setSourceName(result.source_name??'');setNotice(result.items.length?'Đối chiếu địa danh và giấy phép trước khi thêm ảnh.':'Chưa có ảnh phù hợp. Có thể nhập page ID/Wikidata ID hoặc tìm theo tên rồi tự đối chiếu.');
    }catch(e){
      if(e instanceof ApiError && e.status===502 && e.message==='Dịch vụ đang gặp sự cố. Vui lòng thử lại sau.')setError('Không thể lấy dữ liệu hợp lệ từ nguồn ảnh. Hãy kiểm tra kết nối mạng của máy chủ và thử lại; bạn vẫn có thể nhập URL ảnh có nguồn rõ ràng.');
      else fail(e);
    }finally{setBusy(false);}
  };
  const metadata=(row:Candidate):Metadata=>edits[row.id]??{source_url:row.source_url??'',attribution:row.attribution??'',license:row.license??'',position:String(row.position??0)};
  const review=async(row:Candidate,status:string,as_cover=false)=>{
    setBusy(true);setError('');
    try{
      const data=metadata(row);
      if(status==='approved'&&(!data.attribution.trim()||!data.license.trim()))throw new Error('Điền tác giả/ghi công và giấy phép trước khi sử dụng.');
      if(!/^\d+$/.test(data.position)||Number(data.position)>1000)throw new Error('Thứ tự ảnh phải từ 0 đến 1000.');
      const result=await apiFetch<Cover>(`/admin/places/${placeId}/images/${row.id}`,{token,method:'PUT',body:JSON.stringify({...data,source_url:data.source_url||null,position:Number(data.position),status,as_cover})});
      if(mounted.current)onSaved(result);setEdits(old=>{const next={...old};delete next[row.id];return next;});await load();
      setNotice(as_cover?'Đã đặt ảnh bìa. Trạng thái địa điểm được giữ nguyên.':'Đã lưu lựa chọn và thông tin ảnh.');
    }catch(e){fail(e);}finally{setBusy(false);}
  };
  const remove=async()=>{
    setBusy(true);setError('');try{const cover=await apiFetch<Cover>(`/admin/places/${placeId}/image`,{token,method:'DELETE'});if(mounted.current)onSaved(cover);setConfirm(false);await load();}catch(e){fail(e);}finally{setBusy(false);}
  };
  const health=async()=>{
    setBusy(true);setError('');try{const result=await apiFetch<{items:{status:string}[]}>('/admin/images/health',{token,method:'POST',body:JSON.stringify({ids:items.slice(0,10).map(row=>row.id)})});setNotice(`Đã kiểm tra ${result.items.length} ảnh, ${result.items.filter(row=>row.status==='broken').length} ảnh chưa tải được. Ảnh bìa được giữ để Admin xem xét.`);await load();}catch(e){fail(e);}finally{setBusy(false);}
  };
  return <View style={{gap:15,paddingVertical:12}}>
    {uploading&&<PrimaryButton title={t('Hủy tải ảnh')} onPress={()=>uploadRequest.current?.abort()} variant="outline"/>}
    <PlaceImage uri={uri} style={{width:'100%',height:180,borderRadius:13}}/>
    <Text style={{color:C.muted,fontSize:12,lineHeight:19}}>{t('Ảnh mới được lưu trong thư viện. Chọn ảnh bìa hoặc ảnh bổ sung sau khi kiểm tra nguồn, tác giả và giấy phép. Trạng thái địa điểm được giữ nguyên khi thay hoặc gỡ ảnh.')}</Text>
    <ImageDropZone disabled={busy} onFiles={addFiles}/><PrimaryButton title={t('Chọn ảnh từ thiết bị')} loading={busy} onPress={()=>void choose()} variant="outline"/>
    {!!queue.length&&<View style={{gap:10}}><View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{queue.map((entry,index)=><View key={entry.uri+index} style={{gap:7}}><PlaceImage localPreview uri={entry.uri} style={{width:95,height:80,borderRadius:9}}/><PrimaryButton title={`Bỏ ảnh ${index+1}`} disabled={busy} onPress={()=>setQueue(old=>old.filter((_,i)=>i!==index))} variant="outline"/></View>)}</View><PrimaryButton title={`Tải ${queue.length} ảnh lên thư viện`} disabled={busy} onPress={()=>void upload()}/></View>}
    <View style={{gap:10,padding:15,borderWidth:1,borderColor:C.border,borderRadius:13}}><Text style={{fontWeight:'700'}}>{t('Nhập ảnh bằng URL HTTPS')}</Text><TextInput editable={!busy} accessibilityLabel="URL ảnh nhập vào thư viện" value={url} onChangeText={setUrl} placeholder="https://..." autoCapitalize="none" style={input}/><TextInput editable={!busy} accessibilityLabel="Nguồn ảnh URL" value={source} onChangeText={setSource} placeholder={t('URL tham khảo (tùy chọn)')} autoCapitalize="none" style={input}/><TextInput editable={!busy} accessibilityLabel="Tác giả ảnh URL" value={author} onChangeText={setAuthor} placeholder={t('Tác giả / ghi công')} style={input}/><TextInput editable={!busy} accessibilityLabel="Giấy phép ảnh URL" value={license} onChangeText={setLicense} placeholder="CC BY-SA 4.0 / CC0 / ..." style={input}/><PrimaryButton title={t('Lưu ảnh từ URL vào thư viện')} disabled={busy||!url.trim()} onPress={()=>void importUrl()}/></View>
    <View style={{gap:10,padding:15,backgroundColor:C.paper,borderRadius:13}}><Text style={{fontWeight:'700'}}>{t('Ảnh gợi ý từ Wikimedia')}</Text><Text style={{color:C.muted,fontSize:12}}>{t('Ưu tiên định danh Wikipedia/Wikidata. Kết quả tìm theo tên cần Admin xác minh đúng địa danh.')}</Text><TextInput editable={!busy} accessibilityLabel="Wikipedia page ID tìm ảnh" value={wikiId} onChangeText={setWikiId} placeholder="Wikipedia page ID (tùy chọn)" keyboardType="numeric" style={input}/><TextInput editable={!busy} accessibilityLabel="Wikidata ID tìm ảnh" value={wikidataId} onChangeText={setWikidataId} placeholder="Wikidata ID: Q... (tùy chọn)" autoCapitalize="characters" style={input}/><PrimaryButton title={t('Tìm ảnh theo nguồn hoặc ID')} disabled={busy} onPress={()=>void discover()} variant="outline"/><PrimaryButton title={t('Tìm theo tên để tự đối chiếu')} disabled={busy} onPress={()=>void discover(true)} variant="outline"/>{!!sourceName&&<Text>{sourceName}</Text>}
      {suggested.map((row,index)=><View key={row.url} style={{gap:8,padding:10,backgroundColor:'white',borderRadius:12}}><PlaceImage uri={row.url} style={{width:'100%',height:155,borderRadius:10}}/><Text>{row.attribution} · {row.license}</Text><Text style={{color:row.identity_matches_coordinates?C.primary:C.danger,fontSize:12}}>{t(row.identity_matches_coordinates?'Nguồn có tọa độ phù hợp; vẫn cần đối chiếu ảnh.':'Chưa xác minh đúng địa danh. Hãy kiểm tra trước khi sử dụng.')}</Text><PrimaryButton title={`Thêm ảnh gợi ý ${index+1} vào thư viện`} disabled={busy} onPress={()=>void importUrl(row)} variant="outline"/><PrimaryButton title={t('Xem nguồn ảnh')} onPress={()=>void Linking.openURL(row.source_url)} variant="outline"/></View>)}
    </View>
    {!!items.length&&<PrimaryButton title={t('Kiểm tra ảnh lỗi')} disabled={busy} onPress={()=>void health()} variant="outline"/>}
    {!!uri&&<PrimaryButton title={t('Gỡ ảnh khỏi địa điểm')} disabled={busy} onPress={()=>setConfirm(!confirm)} variant="outline"/>}{confirm&&<PrimaryButton title={t('Xác nhận gỡ ảnh')} disabled={busy} onPress={()=>void remove()}/>}
    {items.map(row=><View key={row.id} style={{gap:10,padding:15,borderWidth:1,borderColor:C.border,borderRadius:14}}><PlaceImage uri={row.url} thumbnailUri={row.thumbnail_url} style={{width:'100%',height:150,borderRadius:10}}/><Text style={{fontWeight:'700',color:row.status==='approved'?C.primary:C.muted}}>{t(row.status==='approved'?'Đang sử dụng':row.status==='rejected'?'Không sử dụng':'Chưa sử dụng')}</Text>{row.health_status==='broken'&&<Text style={{color:C.danger}}>{row.health_error}</Text>}
      {(['attribution','license','source_url','position'] as const).map(key=><View key={key} style={{gap:5}}><Text>{t(({attribution:'Tác giả / ghi công',license:'Giấy phép',source_url:'URL nguồn ảnh',position:'Thứ tự ảnh bổ sung'} as const)[key])}</Text><TextInput editable={!busy} accessibilityLabel={`Ảnh ${row.id} ${key}`} value={metadata(row)[key]} onChangeText={value=>setEdits(old=>({...old,[row.id]:{...(old[row.id] ?? metadata(row)),[key]:value}}))} autoCapitalize="none" style={input}/></View>)}
      <PrimaryButton title={t('Đặt làm ảnh bìa')} disabled={busy} onPress={()=>void review(row,'approved',true)}/><PrimaryButton title={t('Thêm ảnh bổ sung')} disabled={busy} onPress={()=>void review(row,'approved')} variant="outline"/><PrimaryButton title={t('Gỡ ảnh khỏi mục đang sử dụng')} disabled={busy} onPress={()=>void review(row,'rejected')} variant="outline"/><PrimaryButton title={t('Mở ảnh gốc')} onPress={()=>void Linking.openURL(mediaUrl(row.url))} variant="outline"/>
    </View>)}
    {(queue.length>0||Object.keys(edits).length>0||Boolean(url))&&<PrimaryButton title={t('Hoàn tác chỉnh sửa ảnh chưa lưu')} disabled={busy} onPress={()=>{setQueue([]);setEdits({});setUrl('');setSource('');setAuthor('');setLicense('');}} variant="outline"/>}
    {!!notice&&<Text accessibilityRole="alert" style={{color:C.primaryDark}}>{t(notice)}</Text>}{!!error&&<Text accessibilityRole="alert" style={{color:C.danger}}>{t(error)}</Text>}
  </View>;
}
const input={borderWidth:1,borderColor:C.border,borderRadius:9,padding:11,color:C.ink};
