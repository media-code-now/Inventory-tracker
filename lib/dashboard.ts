import type {Item,Movement} from './data';
export type StockAlert={id:string;item_id:string;condition:'low_stock'|'out_of_stock';opened_at:string;resolved_at:string|null};
export function dashboardMetrics(items:Item[]){const active=items.filter(i=>i.status==='active');return{active,low:active.filter(i=>i.quantity>0&&i.quantity<=i.minimum),out:active.filter(i=>i.quantity===0),restock:active.filter(i=>i.quantity<=i.minimum),value:active.reduce((n,i)=>n+i.quantity*Number(i.cost),0)};}
export function issuedRanking(items:Item[],movements:Movement[],days:number,now=Date.now()){
 const reversed=new Set(movements.filter(m=>m.reverses_id).map(m=>m.reverses_id));const grouped=new Map<string,{item:Item;count:number;quantity:number}>();
 for(const m of movements){const timestamp=new Date(m.created_at).getTime();if(m.kind!=='remove'||reversed.has(m.id)||timestamp<now-days*86400000||timestamp>now)continue;const item=items.find(i=>i.id===m.item_id);if(!item)continue;const row=grouped.get(item.id)??{item,count:0,quantity:0};row.count++;row.quantity+=m.quantity??Math.abs(m.delta);grouped.set(item.id,row);}
 return [...grouped.values()].sort((a,b)=>b.count-a.count||a.item.name.localeCompare(b.item.name));
}
export type IssuedRow={item_id:string;count:number;quantity:number};
// Server-aggregated issue ranking; same ordering as issuedRanking.
export function rankIssued(items:Item[],rows:IssuedRow[]){
 const byId=new Map(items.map(i=>[i.id,i]));
 return rows.flatMap(r=>{const item=byId.get(r.item_id);return item?[{item,count:Number(r.count),quantity:Number(r.quantity)}]:[];}).sort((a,b)=>b.count-a.count||a.item.name.localeCompare(b.item.name));
}
