import type {Item,Location,Balance,Movement} from './data';
import type {CsvRow,ImportKind} from './csv';
export type RowError={row:number;messages:string[]};
export function validateImport(kind:ImportKind,rows:CsvRow[],items:Item[],locations:Location[],balances:Balance[],movements:Movement[]):RowError[]{
 return rows.flatMap((r,index)=>{const errors:string[]=[];const sku=r.sku?.trim().toLowerCase();const item=items.find(i=>i.sku.toLowerCase()===sku);const matches=locations.filter(l=>l.name.trim().toLowerCase()===r.location?.trim().toLowerCase());
 if(!sku)errors.push('SKU is required');if(r.location&&matches.length!==1)errors.push('Location is unknown or ambiguous');
 if(kind==='items'){
 if(item)errors.push('SKU already exists; existing records are never overwritten');if(rows.filter(x=>x.sku.toLowerCase()===sku).length>1)errors.push('Duplicate SKU in file');
 if(r.barcode&&(items.some(i=>i.barcode===r.barcode)||rows.filter(x=>x.barcode===r.barcode).length>1))errors.push('Duplicate barcode');
 if(!r.name||!r.category||!r.unit)errors.push('Name, category, and unit are required');
 if(!/^[0-9]{1,10}$/.test(r.minimum)||Number(r.minimum)>2147483647)errors.push('Minimum must be a nonnegative integer within range');
 if(!/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(r.unit_cost))errors.push('Unit cost must be nonnegative with at most two decimals');
 }else{
 if(!item)errors.push('SKU does not exist; import items first');else if(item.status!=='active')errors.push('Item is archived');
 if(!r.location)errors.push('Location is required');if(!r.reason)errors.push('Reason is required');
 if(!/^[0-9]{1,10}$/.test(r.quantity)||Number(r.quantity)<1||Number(r.quantity)>2147483647)errors.push('Quantity must be a positive integer within range');
 if(rows.filter(x=>x.sku.toLowerCase()===sku&&x.location.toLowerCase()===r.location.toLowerCase()).length>1)errors.push('Duplicate SKU/location opening balance');
 if(item&&matches.length===1&&(balances.some(b=>b.item_id===item.id&&b.location_id===matches[0].id&&b.quantity!==0)||movements.some(m=>m.item_id===item.id&&(m.from_location_id===matches[0].id||m.to_location_id===matches[0].id))))errors.push('Location already has stock history; receive stock instead');
 }
 return errors.length?[{row:index+2,messages:errors}]:[];});
}
