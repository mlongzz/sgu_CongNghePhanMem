const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
function renderNative(file,{props={},state={},app={},params={id:'db-1'},width=1200}={}){
  let index=0;const raw=[];
  function assertChildren(children,host){
    React.Children.toArray(children).forEach(child=>{
      if(typeof child==='string'||typeof child==='number'||typeof child==='bigint')raw.push({host,value:child});
      else if(React.isValidElement(child)&&child.type===React.Fragment)assertChildren(child.props.children,host);
    });
  }
  const host=name=>function NativeHost({children,testID,accessibilityLabel}){assertChildren(children,name);return React.createElement('div',{'data-testid':testID,'aria-label':accessibilityLabel},children);};
  const View=host('View'),Text=({children})=>React.createElement('span',null,children);
  const PrimaryButton=({title})=>React.createElement(View,null,React.createElement(Text,null,title));
  const empty=()=>null;
  const facade={...React,useState(initial){const current=index++;return React.useState(()=>Object.hasOwn(state,current)?state[current]:typeof initial==='function'?initial():initial);},useEffect:()=>{},useLayoutEffect:()=>{}};
  const common={
    'react':facade,'react/jsx-runtime':require('react/jsx-runtime'),
    'react-native':{View,ScrollView:host('ScrollView'),Pressable:host('Pressable'),SafeAreaView:host('SafeAreaView'),KeyboardAvoidingView:host('KeyboardAvoidingView'),Text,TextInput:empty,ActivityIndicator:empty,Modal:({visible,children})=>visible?React.createElement(View,null,children):null,Platform:{OS:'web'},AppState:{currentState:'active'},Linking:{openURL:async()=>{}},Alert:{alert:()=>{}},useWindowDimensions:()=>({width,height:900}),StyleSheet:{create:value=>value,flatten:value=>value,absoluteFill:{}}},
    'react-native-safe-area-context':{SafeAreaView:host('SafeAreaView')},
    'expo-router':{router:{push:()=>{},replace:()=>{},canGoBack:()=>false},Link:Text,useFocusEffect:()=>{},useLocalSearchParams:()=>params},
    '@expo/vector-icons':{Ionicons:empty},'expo-linear-gradient':{LinearGradient:host('LinearGradient')},'expo-image-picker':{},'expo-speech':{},
  };
  const context={token:'fixture-jwt',setToken:()=>{},user:{id:1,email:'fixture@example.test',full_name:'Fixture',language:'vi'},language:'vi',places:[],favorites:[],history:[],isFavorite:()=>false,findPlace:()=>null,stop:()=>{},...app};
  function dependency(name){
    if(common[name])return common[name];
    if(name.endsWith('/useI18n'))return {useI18n:()=>({t:value=>value})};
    if(name.endsWith('/AppContext'))return {useApp:()=>context};
    if(name.endsWith('/api'))return {apiFetch:async()=>{throw new Error('Component render must not request the network');},checkAdmin:async()=>({enabled:true}),ApiError:class ApiError extends Error{}};
    if(name.endsWith('/colors'))return {C:{primary:'#0a8',ink:'#123',border:'#ddd'}};
    if(name.endsWith('/places'))return {LANGS:[{key:'vi',label:'Tiếng Việt'}]};
    if(name.endsWith('/auth'))return {PrimaryButton,LanguageSelector:empty};
    if(name.endsWith('/Screen'))return {ErrorMessage:({message})=>message?React.createElement(Text,null,message):null};
    if(name.endsWith('/locationOptions'))return {DEFAULT_LOCATION_OPTIONS:{}};
    // Child feature panels are independent; tests load the actual target component.
    if(name.startsWith('.'))return {__esModule:true,default:empty};
    throw new Error('Unmocked import '+name);
  }
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{exports,require:dependency,URL,URLSearchParams,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,console},{filename:file});
  const markup=renderToStaticMarkup(React.createElement(exports.default,props));
  return {raw,markup,hookCount:index};
}
module.exports={renderNative};
