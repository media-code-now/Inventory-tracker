'use client';
import {useEffect,useState} from 'react';
import type {Item,Location} from '../lib/data';
import {IMAGE_TYPES,MAX_SELECT_BYTES} from '../lib/image-prep';
import ItemImage from './item-image';
export default function ItemFields({item,locations,categories}:{item:Item|null;locations:Location[];categories:string[]}){
  const [preview,setPreview]=useState<string|null>(null),[imageError,setImageError]=useState('');
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  return <>
    <div className="form-row"><label>Item name<input name="name" required maxLength={200} defaultValue={item?.name??''} placeholder="e.g. A4 Copy Paper"/></label><label>SKU<input name="sku" required maxLength={100} defaultValue={item?.sku??''} placeholder="OFF-001"/></label></div>
    <div className="form-row"><label>Barcode <span className="field-optional">Optional · unique</span><input name="barcode" maxLength={100} defaultValue={item?.barcode??''} placeholder="Scan or enter a barcode"/></label><label>Category<input name="category" required maxLength={100} list="item-categories" defaultValue={item?.category??categories[0]??''}/><datalist id="item-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist></label></div>
    <label>Description<textarea name="description" rows={3} maxLength={4000} defaultValue={item?.description??''}/></label>
    <div className="form-row"><label>Unit of measure<input name="unit" required maxLength={50} defaultValue={item?.unit??'units'} placeholder="units, boxes, reams…"/></label><label>Unit cost ($)<input name="cost" type="number" min="0" max="9999999999.99" step="0.01" required defaultValue={item?.cost??0}/></label></div>
    <div className="form-row"><label>Minimum stock threshold<input name="minimum" type="number" min="0" max="2147483647" step="1" required defaultValue={item?.minimum??5}/></label><label>Supplier <span className="field-optional">Optional</span><input name="supplier" maxLength={200} defaultValue={item?.supplier??''}/></label></div>
    <label>Default receiving location<select name="location" defaultValue={item?.location_id??''}><option value="">Choose when receiving stock</option>{locations.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</select><small>Changing this default does not move stock. Use a transfer to change quantities by location.</small></label>
    <div className="image-field"><div className="image-field-preview"><ItemImage path={preview??item?.image_path??null} name={item?.name??'Image preview'} large/><div><strong>Item image <span className="field-optional">Optional</span></strong><small>JPEG, PNG or WebP · photos are resized automatically · private office access</small></div></div><label>Upload {item?.image_path?'replacement ':''}image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{setImageError('');const file=event.target.files?.[0];if(!file){setPreview(null);return;}if(!IMAGE_TYPES.includes(file.type as typeof IMAGE_TYPES[number])||file.size>MAX_SELECT_BYTES){event.target.value='';setPreview(null);setImageError('Choose a JPEG, PNG or WebP image smaller than 20 MB.');return;}setPreview(URL.createObjectURL(file));}}/></label>{imageError&&<p className="error" role="alert">{imageError}</p>}{item?.image_path&&<label className="checkbox-field"><input name="remove_image" type="checkbox"/>Remove current image</label>}</div>
    <div className="info-note">{item?'Stock balances are protected. This form edits item information only.':'New items start with zero stock. Record a receive movement for each location’s opening quantity.'} SKU and barcode remain reserved when archived.</div>
  </>;
}
