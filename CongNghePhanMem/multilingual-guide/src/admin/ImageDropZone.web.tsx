import { useState } from 'react';
import { C } from '../theme/colors';
export default function ImageDropZone({disabled,onFiles}:{disabled:boolean;onFiles:(files:Blob[])=>void}) {
  const [dragging,setDragging]=useState(false);
  return <div data-testid="image-drop-zone" onDragOver={event=>{event.preventDefault();if(!disabled)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);if(!disabled)onFiles(Array.from(event.dataTransfer.files));}}
    style={{padding:24,border:`2px dashed ${dragging?C.primary:C.border}`,borderRadius:14,background:dragging?C.primarySoft:C.paper,textAlign:'center',color:C.muted,opacity:disabled?.5:1}}>
    Kéo thả ảnh JPEG, PNG, WebP vào đây · tối đa 10 ảnh, 5 MB/ảnh
  </div>;
}
