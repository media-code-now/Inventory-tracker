export type CsvRow=Record<string,string>;
export type ImportKind='items'|'opening';
export const importHeaders={items:['name','sku','barcode','category','unit','unit_cost','supplier','minimum','location'],opening:['sku','location','quantity','reason','notes']};
export function encodeCsv(rows:(string|number|null|undefined)[][]){return rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export function downloadCsv(filename:string,rows:(string|number|null|undefined)[][]){const url=URL.createObjectURL(new Blob(['\ufeff'+encodeCsv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// Quoted fields may contain commas, escaped quotes, and newlines. Never evaluate cells.
export function parseCsv(source:string,kind:ImportKind):CsvRow[]{
 if(source.length>1048576)throw Error('Maximum file size is 1 MB.');
 const text=source.replace(/^\ufeff/,'');const records:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 const cell=()=>{row.push(field.trim());field='';closed=false;};const line=()=>{cell();if(row.some(v=>v!==''))records.push(row);row=[];};
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}else if(c==='"'){if(field||closed)throw Error(`Invalid quote near record ${records.length+1}.`);quoted=true;}else if(c===',')cell();else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;line();}else{if(closed)throw Error(`Unexpected text after quote near record ${records.length+1}.`);field+=c;}}
 if(quoted)throw Error('Unclosed quoted field.');if(field||row.length||closed)line();
 const headers=records.shift()?.map(h=>h.toLowerCase());if(!headers)throw Error('File is empty.');
 if(new Set(headers).size!==headers.length)throw Error('Duplicate column headers.');
 const expected=importHeaders[kind];if(expected.some(h=>!headers.includes(h))||headers.some(h=>!expected.includes(h)))throw Error('Use the downloaded template columns: '+expected.join(', '));
 if(records.length<1||records.length>1000)throw Error('Import 1–1000 rows at a time.');
 return records.map((cells,i)=>{if(cells.length!==headers.length)throw Error(`Row ${i+2}: expected ${headers.length} columns, found ${cells.length}.`);return Object.fromEntries(headers.map((h,j)=>[h,cells[j]]));});
}
