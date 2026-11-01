import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { apiFetch } from '../services/api';
import { C } from '../theme/colors';
import { PrimaryButton } from '../components/auth';
import { useI18n } from '../hooks/useI18n';

type UserRow={id:number;full_name:string;email:string;online:boolean;active_sessions:number;last_seen_at:string|null;online_seconds:number;offline_seconds_estimated:number|null};
type Summary={as_of:string;online_users:number;offline_users:number;total_users:number;active_today:number;sessions_today:number;sessions_in_range:number;average_session_seconds:number;average_foreground_seconds:number;average_interaction_seconds:number;policy:{retention_days:number};series:{at:string;count:number|null}[]};
type Detail={user:UserRow;sessions:{id:string;device:string;started_at:string;last_seen_at:string;online:boolean;duration_seconds:number;foreground_seconds:number;interaction_seconds:number}[];total:number;page:number};
const duration=(value:number)=>value<60?`${Math.floor(value)} giây`:value<3600?`${Math.floor(value/60)} phút ${Math.floor(value%60)} giây`:`${Math.floor(value/3600)} giờ ${Math.floor(value/60)%60} phút`;
const dateTime=(value:string|null)=>value?new Date(value).toLocaleString('vi-VN'):'Chưa ghi nhận';

export default function PresencePanel({token}:{token:string}) {
  const {t}=useI18n();
  const [period,setPeriod]=useState('day'),[day,setDay]=useState(new Date().toISOString().slice(0,10));
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1);
  const [summary,setSummary]=useState<Summary|null>(null),[users,setUsers]=useState<{items:UserRow[];total:number;pages:number}|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[selectedPoint,setSelectedPoint]=useState<number|null>(null);
  const [selectedUser,setSelectedUser]=useState<number|null>(null),[detail,setDetail]=useState<Detail|null>(null),[detailPage,setDetailPage]=useState(1);
  const focused=useRef(false),pending=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setPage(1);},300);return()=>clearTimeout(timer);},[query]);
  const load=useCallback(async()=>{
    if(pending.current||!focused.current||AppState.currentState!=='active'||Platform.OS==='web'&&document.visibilityState!=='visible')return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)){setError('Nhập ngày theo YYYY-MM-DD.');setLoading(false);return;}
    pending.current=true;const current=new AbortController();controller.current=current;
    try{
      const params=new URLSearchParams({q:search,status,page:String(page),page_size:'20'});
      const [metrics,list]=await Promise.all([
        apiFetch<Summary>(`/admin/presence/summary?${new URLSearchParams({period,day})}`,{token,signal:current.signal}),
        apiFetch<{items:UserRow[];total:number;pages:number}>(`/admin/presence?${params}`,{token,signal:current.signal}),
      ]);
      if(!current.signal.aborted){setSummary(metrics);setUsers(list);setError('');}
    }catch{if(!current.signal.aborted)setError('Chưa cập nhật được dữ liệu hoạt động. Hãy thử lại.');}
    finally{pending.current=false;if(!current.signal.aborted)setLoading(false);}
  },[token,period,day,search,status,page]);
  useFocusEffect(useCallback(()=>{
    focused.current=true;void load();const timer=setInterval(()=>void load(),30_000);
    const state=AppState.addEventListener('change',()=>void load());
    const visible=()=>void load();if(Platform.OS==='web')document.addEventListener('visibilitychange',visible);
    return()=>{focused.current=false;controller.current?.abort();pending.current=false;clearInterval(timer);state.remove();if(Platform.OS==='web')document.removeEventListener('visibilitychange',visible);};
  },[load]));
  useEffect(()=>{
    if(!selectedUser)return;const request=new AbortController();
    void apiFetch<Detail>(`/admin/presence/users/${selectedUser}?page=${detailPage}`,{token,signal:request.signal}).then(value=>{if(!request.signal.aborted)setDetail(value);}).catch(()=>{if(!request.signal.aborted)setError('Chưa tải được chi tiết phiên.');});
    return()=>request.abort();
  },[selectedUser,detailPage,token]);
  const max=Math.max(1,...(summary?.series??[]).map(point=>point.count??0));
  const point=selectedPoint!==null?summary?.series[selectedPoint]:null;
  return <View style={{gap:18}} testID="presence-dashboard">
    <View style={s.card}><Text style={s.title}>{t('Hoạt động người dùng')}</Text><Text style={s.muted}>{t('Online khi có tín hiệu trong 90 giây gần nhất. Nhiều tab hoặc thiết bị chỉ tính một người.')} {t('Tự làm mới mỗi 30 giây khi đang mở màn hình.')}</Text>
      <View style={s.row}>{[['day','Ngày'],['week','7 ngày'],['month','30 ngày']].map(([key,label])=><Pressable accessibilityRole="button" accessibilityState={{selected:period===key}} key={key} onPress={()=>{setPeriod(key);setSelectedPoint(null);}} style={[s.chip,period===key&&s.active]}><Text style={{color:period===key?'white':C.ink}}>{t(label)}</Text></Pressable>)}<TextInput accessibilityLabel="Ngày kết thúc Presence UTC" value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" style={s.input}/><PrimaryButton title={t('Làm mới hoạt động')} onPress={()=>void load()} variant="outline"/></View>
      <Text style={s.muted}>{t('Bộ lọc tính theo UTC. Thời điểm hiển thị theo giờ thiết bị.')}</Text>
    </View>
    {!!error&&<View style={s.error}><Text accessibilityRole="alert" style={{color:C.danger}}>{t(error)}</Text>{summary&&<Text>{t('Đang giữ dữ liệu lần cập nhật trước.')}</Text>}</View>}
    {loading&&!summary&&<ActivityIndicator color={C.primary}/>}
    {summary&&<><View style={s.kpis}>{[
      ['Tổng người dùng',summary.total_users],['Đang online',summary.online_users],['Đang offline',summary.offline_users],['Hoạt động hôm nay · UTC',summary.active_today],['Phiên hôm nay · UTC',summary.sessions_today],['Phiên bắt đầu trong kỳ',summary.sessions_in_range],
    ].map(([label,value])=><View style={s.kpi} key={label}><Text style={s.muted}>{t(String(label))}</Text><Text style={s.metric}>{Number(value).toLocaleString('vi-VN')}</Text></View>)}</View>
      <View style={s.card}><Text style={s.title}>{t('Thời lượng trung bình của phiên bắt đầu trong kỳ')}</Text><View style={s.row}><Text>{t('Tổng phiên')}: {duration(summary.average_session_seconds)}</Text><Text>{t('Ứng dụng đang hoạt động')}: {duration(summary.average_foreground_seconds)}</Text><Text>{t('Tương tác ước tính')}: {duration(summary.average_interaction_seconds)}</Text></View><Text style={s.muted}>{t('Tương tác tính từ thao tác gần đây khi ứng dụng ở foreground; dữ liệu không ghi nội dung thao tác.')}</Text></View>
      <View style={s.card} testID="presence-chart"><Text style={s.title}>{t('Người online theo thời gian')}</Text><Text style={s.muted}>{t('Mỗi cột là số người duy nhất online tại mốc UTC. Nhấn hoặc trỏ vào cột để xem.')}</Text>
        <ScrollView horizontal><View style={{flexDirection:'row',alignItems:'flex-end',height:125,gap:4,paddingVertical:8}}>{summary.series.map((value,index)=><Pressable accessibilityRole="button" accessibilityLabel={`${value.at}: ${value.count===null?'Chưa có dữ liệu':value.count+' người online'}`} key={value.at} onPress={()=>setSelectedPoint(index)} onHoverIn={()=>setSelectedPoint(index)} onFocus={()=>setSelectedPoint(index)} style={{width:16,height:105,justifyContent:'flex-end'}}><View style={{height:value.count===null?4:value.count/max*100,backgroundColor:value.count===null?C.border:selectedPoint===index?C.primaryDark:C.primary,borderRadius:4}}/></Pressable>)}</View></ScrollView>
        <Text accessibilityLiveRegion="polite">{point?`${dateTime(point.at)} · ${point.count===null?'Ngoài thời hạn lưu':point.count+' người online'}`:t('Chọn một cột để xem số liệu.')}</Text><Text style={s.muted}>{t('Lưu chi tiết hoạt động')}: {summary.policy.retention_days} {t('ngày')}. {t('Cập nhật')}: {dateTime(summary.as_of)}</Text>
      </View></>}
    <View style={s.card}><Text style={s.title}>{t('Người dùng hoạt động gần đây')}</Text><View style={s.row}><TextInput accessibilityLabel="Tìm người dùng Presence" placeholder={t('Tìm tên hoặc email')} value={query} onChangeText={setQuery} style={[s.input,{flex:1,minWidth:160}]}/>{[['all','Tất cả người dùng'],['online','Đang online'],['offline','Đang offline']].map(([key,label])=><Pressable accessibilityRole="button" key={key} accessibilityState={{selected:status===key}} onPress={()=>{setStatus(key);setPage(1);}} style={[s.chip,status===key&&s.active]}><Text style={{color:status===key?'white':C.ink}}>{t(label)}</Text></Pressable>)}</View>
      {users?.items.map(user=><Pressable accessibilityRole="button" accessibilityLabel={`Phiên hoạt động ${user.email}`} key={user.id} onPress={()=>{setSelectedUser(user.id);setDetailPage(1);}} style={s.user}><View style={{flex:1,minWidth:160}}><Text style={{fontWeight:'700',color:C.ink}}>{user.full_name}</Text><Text style={s.muted}>{user.email}</Text><Text style={s.muted}>{t('Tín hiệu cuối')}: {dateTime(user.last_seen_at)}</Text></View><View style={{gap:5}}><Text style={{color:user.online?C.primary:C.muted,fontWeight:'700'}}>● {t(user.online?'Online':'Offline')}</Text><Text style={s.muted}>{user.online?`${duration(user.online_seconds)} · ${user.active_sessions} phiên`:user.offline_seconds_estimated===null?t('Chưa có phiên'):`≈ ${duration(user.offline_seconds_estimated)} offline`}</Text></View></Pressable>)}
      {users&&!users.items.length&&<Text style={s.muted}>{t('Chưa có người dùng phù hợp.')}</Text>}
      <View style={s.row}><PrimaryButton title="← Trước" disabled={page<=1} onPress={()=>setPage(page-1)} variant="outline"/><Text>{page}/{Math.max(1,users?.pages??1)}</Text><PrimaryButton title="Sau →" disabled={!users||page>=users.pages} onPress={()=>setPage(page+1)} variant="outline"/></View>
    </View>
    {Boolean(selectedUser)&&<View style={s.card}><View style={s.row}><Text style={s.title}>{detail?.user.full_name??t('Đang tải phiên…')}</Text><PrimaryButton title={t('Đóng chi tiết phiên')} onPress={()=>setSelectedUser(null)} variant="outline"/></View>
      {detail?.sessions.map(session=><View style={s.user} key={session.id}><Text>{session.device} · {dateTime(session.started_at)} · {t(session.online?'Online':'Offline')}</Text><Text style={s.muted}>{t('Tổng phiên')}: {duration(session.duration_seconds)} · {t('Foreground')}: {duration(session.foreground_seconds)} · {t('Tương tác ước tính')}: {duration(session.interaction_seconds)}</Text></View>)}
      {!!detail&&<View style={s.row}><PrimaryButton title="← Phiên trước" disabled={detailPage<=1} onPress={()=>setDetailPage(detailPage-1)} variant="outline"/><PrimaryButton title="Phiên sau →" disabled={detailPage*25>=detail.total} onPress={()=>setDetailPage(detailPage+1)} variant="outline"/></View>}
    </View>}
  </View>;
}
const s=StyleSheet.create({card:{backgroundColor:'white',borderRadius:18,borderWidth:1,borderColor:C.border,padding:18,gap:14},title:{fontSize:17,fontWeight:'700',color:C.darkBlue},muted:{fontSize:12,lineHeight:19,color:C.muted},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10},input:{borderWidth:1,borderColor:C.border,borderRadius:10,padding:12,color:C.ink,minWidth:140},chip:{backgroundColor:C.paper,padding:11,borderRadius:10},active:{backgroundColor:C.primary},kpis:{flexDirection:'row',flexWrap:'wrap',gap:12},kpi:{flex:1,minWidth:150,padding:18,backgroundColor:'white',borderRadius:15,borderWidth:1,borderColor:C.border},metric:{fontSize:30,fontWeight:'800',color:C.darkBlue,marginTop:12},user:{paddingVertical:14,borderTopWidth:1,borderColor:C.border,flexDirection:'row',flexWrap:'wrap',gap:12,alignItems:'center'},error:{padding:15,backgroundColor:C.dangerSoft,borderRadius:12}});
