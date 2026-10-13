const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const test=require('node:test');
const ts=require('typescript');
function load(path,dependencies={}){
 const exports={};
 const output=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(output,{exports,require:name=>dependencies[name]});return exports;
}
const data=load('lib/data.ts');
const {filterInventory,locationQuantity,inventoryStatus}=load('lib/inventory.ts',{'./data':data});
const baseline={search:'',category:'All categories',location:'all',stock:'All statuses',lifecycle:'active'};
const items=[
 {...data.demoItems[0],id:'paper',quantity:12,minimum:5,barcode:'000123',supplier:'Paper Partner'},
 {...data.demoItems[1],id:'pens',quantity:0,minimum:5},
 {...data.demoItems[2],id:'hub',quantity:2,minimum:5,location_id:'l2'},
 {...data.demoItems[3],id:'archived',quantity:4,minimum:5,status:'archived'}
];
const balances=[{item_id:'paper',location_id:'l1',quantity:10},{item_id:'paper',location_id:'l2',quantity:2},{item_id:'pens',location_id:'l1',quantity:0},{item_id:'hub',location_id:'l2',quantity:2},{item_id:'archived',location_id:'l3',quantity:4}];
function ids(overrides){return Array.from(filterInventory(items,balances,data.demoLocations,{...baseline,...overrides}),i=>i.id);}
test('active, archived and all lifecycle filters preserve archives for lookup',()=>{
 assert.deepEqual(ids({}),['paper','pens','hub']);
 assert.deepEqual(ids({lifecycle:'archived'}),['archived']);
 assert.deepEqual(ids({lifecycle:'all'}),['paper','pens','hub','archived']);
});
test('search includes identifiers and supplier; category composes with search',()=>{
 assert.deepEqual(ids({search:'000123'}),['paper']);
 assert.deepEqual(ids({search:'paper partner'}),['paper']);
 assert.deepEqual(ids({search:' OFF-001 '}),['paper']);
 assert.deepEqual(ids({search:'paper',category:'Electronics'}),[]);
});
test('location filter uses independent balances, including zero rows',()=>{
 assert.deepEqual(ids({location:'l2'}),['paper','hub']);
 assert.deepEqual(ids({location:'l1',stock:'Out of stock'}),['pens']);
 assert.equal(locationQuantity(items[0],balances,'all'),12);
 assert.equal(locationQuantity(items[0],balances,'l2'),2);
 assert.equal(inventoryStatus(items[0],balances,'all'),'In stock');
 assert.equal(inventoryStatus(items[0],balances,'l2'),'Low stock');
 assert.deepEqual(ids({location:'l2',stock:'Low stock'}),['paper','hub']);
 assert.deepEqual(ids({location:'l4',stock:'Out of stock'}),[]);
});
test('low stock excludes zero, while needs-restock includes low and empty',()=>{
 assert.deepEqual(ids({stock:'Low stock'}),['hub']);
 assert.deepEqual(ids({stock:'Out of stock'}),['pens']);
 assert.deepEqual(ids({stock:'Needs restock'}),['pens','hub']);
 assert.deepEqual(ids({stock:'In stock'}),['paper']);
 assert.deepEqual(ids({stock:'Low stock',lifecycle:'archived'}),['archived']);
});
