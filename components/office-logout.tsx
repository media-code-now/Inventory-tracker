'use client';
import {usePathname} from 'next/navigation';
import {useState} from 'react';
import {supabase} from '../lib/supabase';
export default function OfficeLogout(){const path=usePathname(),[error,setError]=useState(''),[busy,setBusy]=useState(false);if(path==='/office-unlock'||path==='/office-unlock/')return null;return <div className="office-logout">{error&&<span role="alert">{error}</span>}<button disabled={busy} onClick={async()=>{setBusy(true);try{await supabase?.auth.signOut({scope:'local'});const response=await fetch('/api/office/logout/',{method:'POST'});if(!response.ok)throw Error('Logout failed. Try again.');window.location.replace('/office-unlock/');}catch(e){setError(e instanceof Error?e.message:'Logout failed');setBusy(false);}}}>{busy?'Signing out…':'Lock office / log out'}</button></div>;}
