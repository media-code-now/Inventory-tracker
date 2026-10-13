import {supabase} from './supabase';
export type ErrorCode='snapshot_failed'|'operation_failed'|'import_failed'|'count_failed'|'image_failed'|'ui_crash'|'auth_failed'|'realtime_failed'|'logout_failed';
const areas=new Set(['auth','dashboard','inventory','item-details','stock-movements','stock-counts','storage-locations','reports','imports','team-settings','app']);
// Never accept an Error object, stack trace, URL, form value, token, or user-entered message.
export function reportOperationalError(code:ErrorCode,area='app'){
 const id=crypto.randomUUID();const scope=areas.has(area)?area:'app';
 console.error('[Stockroom]',code,scope,id);
 if(supabase)void (async()=>{try{await supabase.rpc('record_application_error',{p_id:id,p_code:code,p_area:scope})}catch{}})();
 return id;
}
