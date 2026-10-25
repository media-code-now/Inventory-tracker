'use client';
import {useCallback,useEffect,useState} from 'react';
import {History as HistoryIcon,Search} from 'lucide-react';
import {supabase} from '../lib/supabase';
import type {Item,Location,Member} from '../lib/data';
export type AuditEntry={id:number;occurred_at:string;actor_id:string|null;entity:string;entity_id:string;label:string|null;action:'create'|'update'|'delete';changes:Record<string,{from?:unknown;to?:unknown}>};
const entities:Record<string,string>={item:'Item',item_cost:'Unit cost',location:'Location',member:'Team member',invitation:'Invitation',movement:'Stock movement',stock_count:'Physical count',count_entry:'Count entry',import:'CSV import'};
const fields:Record<string,string>={name:'Name',sku:'SKU',barcode:'Barcode',category:'Category',unit:'Unit',minimum:'Minimum',description:'Description',supplier:'Supplier',image_path:'Photo',status:'Status',location_id:'Location',cost:'Unit cost',role:'Role',active:'Active',email:'Email',user_id:'Account',accepted_at:'Accepted',kind:'Type',item_id:'Item',quantity:'Quantity',transfer_quantity:'Transferred',from_location_id:'From',to_location_id:'To',reason:'Reason',notes:'Notes',recipient:'Recipient',reverses_id:'Reverses movement',title:'Title',state:'State',approved_by:'Approved by',approval_reason:'Approval reason',action:'Action',line_id:'Count line',counted_quantity:'Counted',baseline_quantity:'Expected',};
const kinds:Record<string,string>={add:'Stock in',remove:'Stock out',return:'Return',adjust:'Adjustment',transfer:'Transfer',reversal:'Reversal'};
const pageSize=100;
export default function ChangeHistory({items,locations,members,entityId,refreshKey,compact=false}:{items:Item[];locations:Location[];members:Member[];entityId?:string;refreshKey:string|null;compact?:boolean}){
 const [rows,setRows]=useState<AuditEntry[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[more,setMore]=useState(false),[search,setSearch]=useState(''),[entity,setEntity]=useState('all');
 const load=useCallback(async(before:number|null)=>{
  if(!supabase)return;setLoading(true);setError('');
  const {data,error}=await supabase.rpc('audit_history',{p_before:before,p_limit:pageSize,p_entity_id:entityId??null});
  setLoading(false);
  if(error||!Array.isArray(data)){setError('Unable to load change history.');return;}
  setRows(prev=>before===null?data as AuditEntry[]:[...prev,...data as AuditEntry[]]);setMore(data.length===pageSize);
 },[entityId]);
 // Reload the newest page whenever the live snapshot confirms new data.
 useEffect(()=>{void load(null)},[load,refreshKey]);
 if(!supabase)return <section className="panel empty">Change history is recorded in the live workspace. The demo workspace does not keep history.</section>;
 const name=(list:{id:string;name:string}[],id:unknown)=>list.find(x=>x.id===id)?.name;
 const value=(key:string,v:unknown):string=>{
  if(v===null||v===undefined||v==='')return '—';
  if(['location_id','from_location_id','to_location_id'].includes(key))return name(locations,v)??'Removed location';
  if(['approved_by','user_id'].includes(key))return name(members,v)??'Former member';
  if(key==='item_id')return name(items,v)??'Removed item';
  if(key==='kind')return kinds[String(v)]??String(v);
  if(key==='image_path')return 'Updated';
  if(typeof v==='boolean')return v?'Yes':'No';
  if(key==='accepted_at'&&typeof v==='string')return new Date(v).toLocaleString('en-US');
  const text=typeof v==='object'?JSON.stringify(v):String(v);return text.length>80?text.slice(0,79)+'…':text;
 };
 const subject=(r:AuditEntry)=>r.label??(['item','item_cost'].includes(r.entity)?name(items,r.entity_id):r.entity==='movement'?name(items,r.changes.item_id?.to):undefined)??'';
 const verb=(r:AuditEntry)=>{
  if(r.entity==='movement')return kinds[String(r.changes.kind?.to)]??'Posted';
  if(r.entity==='item'&&r.changes.status)return r.changes.status.to==='archived'?'Archived':'Restored';
  if(r.entity==='member'&&r.changes.active&&r.action==='update')return r.changes.active.to?'Reactivated':'Deactivated';
  return r.action==='create'?'Created':r.action==='update'?'Updated':'Deleted';
 };
 const details=(r:AuditEntry)=>Object.entries(r.changes).filter(([key])=>!(r.entity==='movement'&&['kind','item_id'].includes(key))).map(([key,c])=>{
  const label=fields[key]??key;
  return r.action==='update'?`${label}: ${value(key,c.from)} → ${value(key,c.to)}`:`${label}: ${value(key,r.action==='create'?c.to:c.from)}`;
 });
 const needle=search.trim().toLowerCase();
 const shown=rows.filter(r=>(entity==='all'||r.entity===entity)&&(!needle||[entities[r.entity]??r.entity,subject(r),verb(r),name(members,r.actor_id)??'',...details(r)].join(' ').toLowerCase().includes(needle)));
 return <section className="panel"><div className="panel-heading"><div><h2>Change history</h2><p>{compact?'Edits to this item and its unit cost.':'Who changed what, and when. History is append-only and cannot be edited.'}</p></div><HistoryIcon size={20}/></div>
  {!compact&&<div className="table-toolbar"><div className="search"><Search size={17}/><input aria-label="Search change history" placeholder="Search item, person, or field…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="filters"><select aria-label="Record type" value={entity} onChange={e=>setEntity(e.target.value)}><option value="all">All records</option>{Object.entries(entities).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div></div>}
  {error&&<div className="archive-note" role="alert">{error} <button className="text-button" onClick={()=>void load(null)}>Retry</button></div>}
  <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable change history"><table><thead><tr><th>WHEN</th><th>WHO</th><th>RECORD</th><th>CHANGE</th><th>DETAILS</th></tr></thead><tbody>
   {shown.map(r=><tr key={r.id}><td className="muted">{new Date(r.occurred_at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</td><td>{r.actor_id?name(members,r.actor_id)??'Former member':'System'}</td><td><strong>{subject(r)||'—'}</strong><small>{entities[r.entity]??r.entity}</small></td><td><span className="badge">{verb(r)}</span></td><td className="history-details">{details(r).map((d,i)=><small key={i}>{d}</small>)}</td></tr>)}
   {!shown.length&&<tr><td colSpan={5} className="empty">{loading?'Loading change history…':rows.length?'No changes match these filters.':'No changes recorded yet.'}</td></tr>}
  </tbody></table></div>
  <div className="table-footer">{shown.length} {shown.length===1?'change':'changes'}{more&&<button className="text-button" disabled={loading} onClick={()=>void load(rows[rows.length-1]?.id??null)}>{loading?'Loading…':'Load older changes'}</button>}</div>
 </section>;
}
