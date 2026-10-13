'use client';
import {useEffect,useState} from 'react';
import {Package} from 'lucide-react';
import {supabase} from '../lib/supabase';
export default function ItemImage({path,name,large=false}:{path:string|null;name:string;large?:boolean}){
  const [url,setUrl]=useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false,objectUrl:string|undefined;
    setUrl(null);
    if(!path)return;
    if(path.startsWith('blob:')){setUrl(path);return;}
    if(!supabase)return;
    // Authenticated downloads recheck Storage RLS. No public image URLs or signed bearer URLs.
    supabase.storage.from('item-images').download(path).then(({data,error})=>{
      if(cancelled||error||!data)return;
      objectUrl=URL.createObjectURL(data);setUrl(objectUrl);
    });
    return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[path]);
  return <span className={'item-icon item-photo '+(large?'large':'')}>{url?<img src={url} alt={name}/>:<Package size={large?30:19}/>}</span>;
}
