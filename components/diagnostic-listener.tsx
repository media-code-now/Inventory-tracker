'use client';
import {useEffect} from 'react';
import {reportOperationalError} from '../lib/diagnostics';
export default function DiagnosticListener(){
 useEffect(()=>{let last=0;const report=()=>{if(Date.now()-last<5000)return;last=Date.now();reportOperationalError('ui_crash');};window.addEventListener('error',report);window.addEventListener('unhandledrejection',report);return()=>{window.removeEventListener('error',report);window.removeEventListener('unhandledrejection',report)};},[]);
 return null;
}
