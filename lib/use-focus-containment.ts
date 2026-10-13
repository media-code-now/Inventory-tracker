'use client';
import {useEffect,type RefObject} from 'react';
export function useFocusContainment(open:boolean,container:RefObject<HTMLElement|null>,close:()=>void){
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;const el=container.current;if(!el)return;const controls=()=>Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(e=>!e.closest('fieldset[disabled]')&&e.getClientRects().length>0);controls()[0]?.focus();
 const handle=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const list=controls(),first=list[0],last=list[list.length-1];if(!first){event.preventDefault();el.focus();return;}if(event.shiftKey&&(document.activeElement===first||!el.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!el.contains(document.activeElement))){event.preventDefault();first.focus();}}};document.addEventListener('keydown',handle);return()=>{document.removeEventListener('keydown',handle);previous?.focus();};
 },[open,container,close]);
}
