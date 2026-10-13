import {status,type Item,type Balance,type Location} from './data';
export type InventoryFilters={search:string;category:string;location:string;stock:string;lifecycle:'active'|'archived'|'all'};
export function locationQuantity(item:Item,balances:Balance[],location:string){
  return location==='all'?item.quantity:balances.find(b=>b.item_id===item.id&&b.location_id===location)?.quantity??0;
}
export function inventoryStatus(item:Item,balances:Balance[],location:string){return status({...item,quantity:locationQuantity(item,balances,location)});}
export function filterInventory(items:Item[],balances:Balance[],locations:Location[],filters:InventoryFilters){
  const needle=filters.search.trim().toLowerCase();
  return items.filter(item=>{
    if(filters.lifecycle!=='all'&&item.status!==filters.lifecycle)return false;
    if(filters.category!=='All categories'&&item.category!==filters.category)return false;
    // A location is relevant when there is a balance row (including zero) or it is the item's default location.
    if(filters.location!=='all'&&item.location_id!==filters.location&&!balances.some(b=>b.item_id===item.id&&b.location_id===filters.location))return false;
    const quantity=locationQuantity(item,balances,filters.location);
    if(filters.stock==='Low stock'&&!(quantity>0&&quantity<=item.minimum))return false;
    if(filters.stock==='Out of stock'&&quantity!==0)return false;
    if(filters.stock==='Needs restock'&&quantity>item.minimum)return false;
    if(filters.stock==='In stock'&&quantity<=item.minimum)return false;
    const locationNames=locations.filter(l=>l.id===item.location_id||balances.some(b=>b.item_id===item.id&&b.location_id===l.id)).map(l=>l.name).join(' ');
    return [item.name,item.sku,item.barcode??'',item.category,item.description,item.supplier??'',locationNames].join(' ').toLowerCase().includes(needle);
  });
}
