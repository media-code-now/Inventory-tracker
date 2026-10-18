// Browser-side image preparation for item photos.
// Phone photos are commonly 3–8 MB; the app displays them at 72 px. Downscale and re-encode
// before upload so requests stay well under hosting body limits and finish quickly.
export const IMAGE_TYPES=['image/jpeg','image/png','image/webp'] as const;
export const MAX_SELECT_BYTES=20*1024*1024; // what a user may pick
export const MAX_UPLOAD_BYTES=3*1024*1024;  // what we send (Netlify rejects ~4.5 MB+ bodies)
const MAX_EDGE=1280;
export function imageExtension(type:string){return type==='image/jpeg'?'jpg':type==='image/png'?'png':'webp';}
async function decode(file:Blob):Promise<ImageBitmap|HTMLImageElement>{
 if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch{/* fall through to <img> */}}
 const url=URL.createObjectURL(file);
 try{return await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Unable to read this image.'));img.src=url;});}
 finally{setTimeout(()=>URL.revokeObjectURL(url),0);}
}
function toBlob(canvas:HTMLCanvasElement,type:string,quality:number){return new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,type,quality));}
/** Returns a JPEG/PNG/WebP blob no larger than MAX_UPLOAD_BYTES, or the original if it is already small. */
export async function prepareImage(file:File):Promise<Blob>{
 if(!IMAGE_TYPES.includes(file.type as typeof IMAGE_TYPES[number]))throw new Error('Choose a JPEG, PNG or WebP image.');
 if(file.size>MAX_SELECT_BYTES)throw new Error('Choose an image smaller than 20 MB.');
 const source=await decode(file);
 const width='naturalWidth' in source?source.naturalWidth:source.width,height='naturalHeight' in source?source.naturalHeight:source.height;
 if(!width||!height)throw new Error('Unable to read this image.');
 const scale=Math.min(1,MAX_EDGE/Math.max(width,height));
 if(scale===1&&file.size<=MAX_UPLOAD_BYTES)return file;
 const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
 const context=canvas.getContext('2d');if(!context)throw new Error('Image processing is not available in this browser.');
 context.drawImage(source,0,0,canvas.width,canvas.height);
 if('close' in source)source.close();
 // PNG keeps transparency; everything else becomes JPEG, stepping quality down until it fits.
 const type=file.type==='image/png'?'image/png':'image/jpeg';
 for(const quality of [0.86,0.78,0.7,0.6,0.5]){
  const blob=await toBlob(canvas,type,quality);
  if(blob&&blob.size<=MAX_UPLOAD_BYTES)return blob;
  if(type==='image/png'){const jpeg=await toBlob(canvas,'image/jpeg',quality);if(jpeg&&jpeg.size<=MAX_UPLOAD_BYTES)return jpeg;}
 }
 throw new Error('This image is too large even after compression. Choose a smaller image.');
}
