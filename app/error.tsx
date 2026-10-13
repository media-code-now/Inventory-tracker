'use client';
import {useEffect,useState} from 'react';
import {reportOperationalError} from '../lib/diagnostics';
export default function ErrorPage({reset}:{error:Error & {digest?:string};reset:()=>void}){
 const [reference,setReference]=useState('');
 useEffect(()=>{setReference(reportOperationalError('ui_crash'));},[]);
 return <main className="login"><section className="login-card"><h1>Unable to display this page.</h1><p role="alert">Your last saved inventory records remain in the database. Reconnect and check the movement history before retrying an uncertain transaction.</p><p>Error reference: {reference||'Preparing…'}</p><button className="primary" onClick={reset}>Try again</button><a className="secondary" href="/">Open dashboard</a></section></main>;
}
