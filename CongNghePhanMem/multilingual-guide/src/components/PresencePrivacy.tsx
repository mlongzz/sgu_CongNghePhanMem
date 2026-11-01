import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { apiFetch } from '../services/api';
import { presenceClient } from '../services/presence';
import { PrimaryButton } from './auth';
import { C } from '../theme/colors';
import { useI18n } from '../hooks/useI18n';

export default function PresencePrivacy({token}:{token:string}) {
  const {t}=useI18n();
  const [policy,setPolicy]=useState<{enabled:boolean;retention_days:number}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  useEffect(()=>{const controller=new AbortController();void apiFetch<{enabled:boolean;retention_days:number}>('/presence/preferences',{token,signal:controller.signal}).then(setPolicy).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[token]);
  const change=async(remove=false)=>{
    setBusy(true);setError('');
    try{
      if(remove){await apiFetch('/presence/me',{token,method:'DELETE'});presenceClient.setEnabled(false);setPolicy(p=>p?{...p,enabled:false}:p);setConfirm(false);}
      else{const result=await apiFetch<{enabled:boolean;retention_days:number}>('/presence/preferences',{token,method:'PUT',body:JSON.stringify({enabled:!policy?.enabled})});setPolicy(result);presenceClient.setEnabled(result.enabled);void presenceClient.pulse(true);}
    }catch(e){setError(e instanceof Error?e.message:t('Không thể cập nhật quyền riêng tư.'));}finally{setBusy(false);}
  };
  return <View style={{gap:12,padding:18,borderWidth:1,borderColor:C.border,borderRadius:16,backgroundColor:C.white}}>
    <Text style={{fontWeight:'700',color:C.darkBlue}}>{t('Dữ liệu hoạt động')}</Text>
    <Text style={{fontSize:12,lineHeight:19,color:C.muted}}>{t('Chỉ ghi thời điểm phiên, nền tảng và thời lượng hoạt động; không ghi GPS, nội dung nhập hay lịch sử trang.')} {policy?`${t('Thời hạn lưu')}: ${policy.retention_days} ${t('ngày')}.`:''} {t('Trạng thái offline và thời gian tương tác là ước tính. Chỉ Admin xem dữ liệu định danh.')}</Text>
    {policy && <PrimaryButton title={t(policy.enabled?'Tạm dừng theo dõi hoạt động':'Bật theo dõi hoạt động')} disabled={busy} onPress={()=>void change()} variant="outline"/>}
    <PrimaryButton title={t('Xóa dữ liệu hoạt động của tôi')} disabled={busy} onPress={()=>setConfirm(true)} variant="outline"/>
    {confirm && <><Text>{t('Xóa lịch sử hoạt động và tắt theo dõi cho đến khi bạn bật lại?')}</Text><PrimaryButton title={t('Xác nhận xóa dữ liệu hoạt động')} loading={busy} onPress={()=>void change(true)}/><PrimaryButton title={t('Hủy')} onPress={()=>setConfirm(false)} variant="outline"/></>}
    {!!error && <Text accessibilityRole="alert" style={{color:C.danger}}>{t(error)}</Text>}
  </View>;
}
