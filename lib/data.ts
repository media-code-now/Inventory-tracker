export type Item = {id:string;name:string;sku:string;category:string;unit:string;quantity:number;minimum:number;cost:number;location_id:string|null;description:string;barcode:string|null;supplier:string|null;image_path:string|null;status:"active"|"archived";created_at:string;updated_at:string;archived_at:string|null};
export type Location = {id:string;name:string;description:string};
export type Member = {id:string;name:string;role:'admin'|'staff'|'viewer';active:boolean};
export type Movement = {id:string;item_id:string;actor_id:string;kind:'add'|'remove'|'return'|'adjust'|'transfer'|'reversal';reason?:string;notes?:string|null;recipient?:string|null;quantity?:number;requested_quantity?:number|null;request_id?:string|null;reverses_id?:string|null;from_location_id?:string|null;to_location_id?:string|null;transfer_quantity?:number|null;source_before?:number|null;source_after?:number|null;target_before?:number|null;target_after?:number|null;delta:number;before_quantity:number;after_quantity:number;note:string;created_at:string};
export const demoLocations:Location[]=[{id:'l1',name:'Supply room',description:'Floor 1 · Main office supplies'},{id:'l2',name:'IT cabinet',description:'Floor 2 · Equipment & accessories'},{id:'l3',name:'Kitchen',description:'Floor 1 · Breakroom essentials'},{id:'l4',name:'Storage closet',description:'Floor 2 · Cleaning & facilities'}];
export const demoMembers:Member[]=[{id:'demo',name:'Alex Morgan',role:'admin',active:true},{id:'d2',name:'Jamie Chen',role:'staff',active:true},{id:'d3',name:'Sam Rivera',role:'staff',active:true}];
export const demoItems:Item[]=[
 ['1','A4 Copy Paper','OFF-001','Office supplies','reams',48,15,6.5,'l1','Premium multipurpose paper, 500 sheets per ream.'],
 ['2','Black Ballpoint Pens','OFF-002','Office supplies','boxes',8,10,12,'l1','Box of 12 everyday ballpoint pens.'],
 ['3','USB-C Hub','IT-001','Electronics','units',24,5,49,'l2','6-in-1 USB-C adapter for office laptops.'],
 ['4','Coffee Beans','KIT-001','Kitchen','bags',6,8,18,'l3','1 kg bags of medium roast coffee.'],
 ['5','Wireless Mouse','IT-002','Electronics','units',18,5,29,'l2','Wireless ergonomic mouse.'],
 ['6','Sticky Notes','OFF-003','Office supplies','packs',64,15,4.5,'l1','Assorted colors, pack of 6.'],
 ['7','Hand Sanitizer','FAC-001','Facilities','bottles',0,5,8,'l4','500 ml pump bottles.'],
 ['8','Notebooks','OFF-004','Office supplies','units',36,10,7,'l1','A5 hardcover notebooks.'],
 ['9','Dish Soap','KIT-002','Kitchen','bottles',12,4,5,'l3','Refill bottles for the kitchen.'],
 ['10','HDMI Cable','IT-003','Electronics','units',15,5,14,'l2','2 meter HDMI cable.']
].map(([id,name,sku,category,unit,quantity,minimum,cost,location_id,description])=>({id,name,sku,category,unit,quantity,minimum,cost,location_id,description,barcode:null,supplier:null,image_path:null,status:"active",created_at:"2026-10-01T16:00:00.000Z",updated_at:"2026-10-01T16:00:00.000Z",archived_at:null} as Item));
export function demoMovements():Movement[]{return [{id:'m1',item_id:'1',actor_id:'d2',kind:'add',delta:20,before_quantity:28,after_quantity:48,to_location_id:'l1',quantity:20,note:'Weekly supply delivery',created_at:new Date(Date.now()-1800000).toISOString()},{id:'m2',item_id:'4',actor_id:'d3',kind:'remove',delta:-2,before_quantity:8,after_quantity:6,from_location_id:'l3',quantity:2,note:'Restocked breakroom',created_at:new Date(Date.now()-7200000).toISOString()},{id:'m3',item_id:'3',actor_id:'demo',kind:'add',delta:10,before_quantity:14,after_quantity:24,to_location_id:'l2',quantity:10,note:'New equipment delivery',created_at:new Date(Date.now()-10800000).toISOString()},{id:'m4',item_id:'2',actor_id:'d2',kind:'remove',delta:-4,before_quantity:12,after_quantity:8,from_location_id:'l1',quantity:4,note:'Distributed to teams',created_at:new Date(Date.now()-86400000).toISOString()}];}
export function status(i:Item){return i.quantity===0?'Out of stock':i.quantity<=i.minimum?'Low stock':'In stock';}

export type Balance = {item_id:string;location_id:string;quantity:number};
export type Invitation = {id:string;email:string;name:string;role:Member['role'];user_id:string|null;status:'sending'|'pending'|'accepted'|'revoked'|'failed';expires_at:string;created_at:string};
