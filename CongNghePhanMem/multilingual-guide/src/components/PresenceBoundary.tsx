import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../services/api';
import { presenceClient } from '../services/presence';
import { C } from '../theme/colors';
import { useI18n } from '../hooks/useI18n';

export default function PresenceBoundary({ children }: {children: ReactNode}) {
  const { token, user } = useApp();
  const { t } = useI18n();
  const [notice, setNotice] = useState(false);
  const [days,setDays] = useState(30);
  useEffect(() => {
    if (!token || !user) { presenceClient.setAccount(null,null); return; }
    presenceClient.setAccount(user.id,token);
    let active=true; const controller=new AbortController(); let retry:ReturnType<typeof setTimeout>;
    const load=async()=>{
      try {
        const policy=await apiFetch<{enabled:boolean;retention_days:number}>('/presence/preferences',{token,signal:controller.signal,timeoutMs:8000});
        if(!active)return;
        presenceClient.setAccount(user.id,token);presenceClient.setEnabled(policy.enabled);setDays(policy.retention_days);
        void presenceClient.pulse(true);
        const acknowledged=await AsyncStorage.getItem(`mg_presence_notice_v1_${user.id}`);
        if(active)setNotice(!acknowledged);
      } catch { if(active)retry=setTimeout(()=>void load(),30_000); }
    };
    void load();return()=>{active=false;controller.abort();clearTimeout(retry);};
  },[token,user]);
  useEffect(()=>{
    let timer:ReturnType<typeof setInterval>|undefined;
    const visibility=()=>{
      const visible=Platform.OS==='web'?document.visibilityState==='visible':AppState.currentState==='active';
      presenceClient.setVisible(visible);if(timer)clearInterval(timer);
      if(visible)timer=setInterval(()=>presenceClient.tick(),1000);
    };
    const activity=()=>presenceClient.interact();
    const pagehide=()=>{presenceClient.setVisible(false);presenceClient.end('closed');if(timer)clearInterval(timer);};
    presenceClient.setDevice(Platform.OS);visibility();const subscription=AppState.addEventListener('change',visibility);
    if(Platform.OS==='web'){
      document.addEventListener('visibilitychange',visibility);
      window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',visibility);
      for(const event of ['pointerdown','keydown','wheel'])window.addEventListener(event,activity,{passive:true});
    }
    return()=>{
      if(timer)clearInterval(timer);subscription.remove();presenceClient.dispose();
      if(Platform.OS==='web'){
        document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',visibility);
        for(const event of ['pointerdown','keydown','wheel'])window.removeEventListener(event,activity);
      }
    };
  },[]);
  return <View style={{flex:1}} onTouchStart={()=>presenceClient.interact()}>
    {!!token && notice && <View accessibilityRole="note" style={{backgroundColor:C.primarySoft,padding:10,flexDirection:'row',gap:10,alignItems:'center'}}>
      <Text style={{flex:1,color:C.darkBlue,fontSize:11}}>{t('Ứng dụng ghi nhận thời gian hoạt động, không ghi GPS hay nội dung nhập.')} {t('Thời hạn lưu')}: {days} {t('ngày')}.</Text>
      <Pressable accessibilityRole="button" onPress={()=>router.push('/account')}><Text style={{color:C.primaryDark,fontSize:11}}>{t('Quyền riêng tư')}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Đóng thông báo hoạt động')} onPress={()=>{setNotice(false);if(user)void AsyncStorage.setItem(`mg_presence_notice_v1_${user.id}`,'1');}}><Text style={{padding:8}}>×</Text></Pressable>
    </View>}
    {children}
  </View>;
}
