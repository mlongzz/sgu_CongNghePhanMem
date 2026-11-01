const test=require('node:test'),assert=require('node:assert/strict');
const {renderNative}=require('./helpers/native-render.cjs');
const render=(file,options)=>{const result=renderNative(file,options);assert.deepEqual(result.raw,[],JSON.stringify(result.raw));return result;};
test('image editor empty URL/queue/edits and a populated upload queue never leak primitives',()=>{
  render('src/admin/PlaceImageEditor.tsx',{props:{placeId:1,uri:'',token:'fixture',onSaved:()=>{}}});
  render('src/admin/PlaceImageEditor.tsx',{props:{placeId:1,uri:'',token:'fixture',onSaved:()=>{}},state:{5:[{uri:'blob:fixture',blob:{}}]}});
});
test('import preview permits absent and empty source fields without rendering an empty text child',()=>{
  for(const row of [{},{source_url:'',sources:[],source_id:''},{source_url:'https://www.openstreetmap.org/node/1'}]){
    render('src/admin/ImportPanel.tsx',{props:{token:'fixture'},state:{1:{type:'osm',result:{preview_token:'fixture',rows:[row]}}}});
  }
});
test('presence selected user null or zero renders no detail or stray zero',()=>{
  for(const id of [null,0,1]){
    const result=render('src/admin/PresencePanel.tsx',{props:{token:'fixture'},state:{11:id}});
    assert.equal(result.markup.includes('Đóng chi tiết phiên'),id===1);
  }
});
test('journey stops empty, missing, published with empty deletion date, draft or archived are safe',()=>{
  render('src/admin/JourneyStopsEditor.tsx',{props:{value:'',onChange:()=>{}}});
  for(const row of [undefined,{id:1,name:'Published fixture',publication_status:'published',deleted_at:''},{id:1,name:'Draft fixture',publication_status:'draft'},{id:1,name:'Archived fixture',publication_status:'published',deleted_at:'2026-10-27'}]){
    const result=render('src/admin/JourneyStopsEditor.tsx',{props:{value:'1',onChange:()=>{}},state:{1:row?{1:row}:{}}});
    assert.equal(result.markup.includes('chưa hiển thị cho người dùng'),!!row&&row.publication_status==='draft'&&!row.deleted_at);
    assert.equal(result.markup.includes('Điểm đã lưu trữ.'),!!row&&!!row.deleted_at);
  }
});
test('gallery empty and approved photos with empty or missing source links render safely',()=>{
  render('src/components/PlaceGallery.tsx',{props:{placeId:'db-1'}});
  for(const source of [undefined,'','https://commons.wikimedia.org/wiki/File:Fixture.jpg'])render('src/components/PlaceGallery.tsx',{props:{placeId:'db-1'},state:{0:{id:'db-1',items:[{id:1,url:'https://images.example.org/fixture.jpg',source_url:source}]}}});
});
test('dashboard missing and empty tokens stay behind the existing authorization guard',()=>{
  for(const token of [null,''])for(const section of ['overview','presence','images','imports','journeys']){
    const result=render('src/admin/Dashboard.tsx',{app:{token},state:{0:{token,allowed:true},1:section}});
    assert.match(result.markup,/Khu vực quản trị/);
  }
});
test('profile missing and empty tokens never leak a text child',()=>{
  for(const token of [null,''])render('app/(tabs)/profile.tsx',{app:{token,user:null}});
});
const place={id:'db-1',title:'Fixture place',image:'',district:'Fixture district',latitude:10,longitude:106,category:'Văn hóa',subtitle:{vi:'Fixture subtitle'},source:'backend'};
test('place detail empty provenance and narration links never escape Text',()=>{
  const names=['sourceUrl','sourceLicense','imageAttribution','imageLicense','imageSourceUrl'];
  for(let variant=0;variant<names.length+1;variant++){
    const p={...place,...Object.fromEntries(names.map(name=>[name,''])),...(variant?{[names[variant-1]]:'Fixture credit'}:{})};
    const content={text:'Fixture narration',source:'published',sourceUrl:'',licenseUrl:''};
    render('app/place/[id].tsx',{app:{findPlace:()=>p},state:{7:{key:'db-1:vi:0',place:p,content,error:''}}});
  }
});
