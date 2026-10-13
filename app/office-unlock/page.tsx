'use client';
import {useState} from 'react';
export default function OfficeUnlock(){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <main className="office-gate"><section className="office-gate-card"><div className="office-lock" aria-hidden="true">⌑</div><h1>Office inventory</h1><p>Enter your office password to continue.</p><form onSubmit={async event=>{
  event.preventDefault();setBusy(true);setError('');
  try{const password=new FormData(event.currentTarget).get('password');const response=await fetch('/api/office/login/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const data=await response.json();if(!response.ok)throw Error(data.error);const next=new URLSearchParams(window.location.search).get('next')??'/';const target=new URL(next,window.location.origin);window.location.replace(target.origin===window.location.origin&&!target.pathname.startsWith('/office-unlock')?target.pathname+target.search+window.location.hash:'/');}catch(e){setError(e instanceof Error?e.message:'Unable to connect');setBusy(false);}
 }}><label htmlFor="office-password">Office password</label><input id="office-password" name="password" type="password" autoComplete="current-password" required autoFocus disabled={busy}/>{error&&<p role="alert" className="error-box">{error}</p>}<button className="primary" disabled={busy}>{busy?'Checking…':'Continue'}</button></form><small>Your individual staff login is still required.</small></section></main>;
}
