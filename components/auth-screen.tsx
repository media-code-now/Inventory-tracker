'use client';
import {useEffect,useState,useRef,type FormEvent} from 'react';
import {Package,ArrowRight,ShieldCheck,LogOut} from 'lucide-react';
import {reportOperationalError} from '../lib/diagnostics';
import {supabase} from '../lib/supabase';
export type AuthMode='login'|'forgot'|'reset'|'invite';
export default function AuthScreen({initialMode='login'}:{initialMode?:AuthMode}){
  const [mode,setMode]=useState<AuthMode>(initialMode),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[sessionReady,setSessionReady]=useState(false),[validSession,setValidSession]=useState(false);
  const submitting=useRef(false);
  useEffect(()=>{
    if(!supabase)return;
    let cancelled=false;
    const validate=async()=>{const {data}=await supabase!.auth.getUser();if(!cancelled){setValidSession(!!data.user);setSessionReady(true)}};
    validate();
    const {data}=supabase.auth.onAuthStateChange(()=>{setTimeout(validate,0)});
    const params=new URLSearchParams(window.location.hash.slice(1));
    if(params.get('error_description'))setError(params.get('error_description')!);
    return()=>{cancelled=true;data.subscription.unsubscribe()};
  },[]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!supabase||submitting.current)return;submitting.current=true;setBusy(true);setError('');setMessage('');
    const data=new FormData(event.currentTarget);const email=String(data.get('email')??'').trim(),password=String(data.get('password')??'');
    try {
      if(mode==='forgot'){
        const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'/auth/reset-password/'});
        if(error)throw new Error('Unable to request a reset right now. Please try again later.');
        setMessage('If this email has an account, a password reset link will arrive shortly.');
      } else if(mode==='login'){
        const {error}=await supabase.auth.signInWithPassword({email,password});
        if(error)throw new Error('Unable to sign in. Check your email and password.');
        window.location.assign('/');
      } else {
        if(password.length<12)throw new Error('Use at least 12 characters.');
        if(password!==data.get('confirmation'))throw new Error('Passwords do not match.');
        const {data:identity,error:identityError}=await supabase.auth.getUser();
        if(identityError||!identity.user)throw new Error('This link is invalid or expired. Request a new link.');
        const {error}=await supabase.auth.updateUser({password});if(error)throw error;
        if(mode==='invite'){
          const {error}=await supabase.rpc('accept_invitation');if(error)throw error;
          window.location.assign('/');
        } else {
          await supabase.auth.signOut({scope:'global'});
          setValidSession(false);setMode('login');setMessage('Password updated. Sign in with your new password.');
          window.history.replaceState({},'', '/login/');
        }
      }
    } catch(e){reportOperationalError('auth_failed','auth');setError(e instanceof Error?e.message:(e as {message:string}).message??'Unable to continue.');}
    finally{submitting.current=false;setBusy(false)}
  }
  const requiresSession=mode==='reset'||mode==='invite';
  return <div className="login"><div className="login-card"><div className="brand"><div className="brand-icon"><Package/></div>stockroom<span className="brand-period">.</span></div><span className="eyebrow">INVITATION-ONLY OFFICE WORKSPACE</span><h1>{mode==='login'?'Welcome back.':mode==='forgot'?'Reset your password.':mode==='invite'?'Accept your invitation.':'Choose a new password.'}</h1><p>{mode==='login'?'Sign in to your private office workspace.':mode==='forgot'?'Enter your email to request a secure recovery link.':mode==='invite'?'Set your password to join the office. Your administrator has already assigned your role.':'Use a unique password with at least 12 characters.'}</p>
    {!supabase?<div className="info-note">Authentication is not configured. Connect the Supabase project before inviting or signing in users.</div>:requiresSession&&!sessionReady?<div className="info-note" role="status">Verifying your link…</div>:requiresSession&&!validSession?<><div className="error-box">Your invitation or recovery link is invalid or expired. Ask your admin for an invitation, or request a new password reset link.</div><button className="secondary" onClick={()=>{setMode('forgot');setError('')}}>Request password reset</button></>:<form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy} style={{border:0,padding:0,margin:0}}>
      {(mode==='login'||mode==='forgot')&&<label>Email<input name="email" type="email" required autoComplete="email" maxLength={254}/></label>}
      {mode!=='forgot'&&<label>{requiresSession?'New password':'Password'}<input name="password" type="password" required minLength={requiresSession?12:undefined} autoComplete={requiresSession?'new-password':'current-password'}/></label>}
      {requiresSession&&<label>Confirm password<input name="confirmation" type="password" required minLength={12} autoComplete="new-password"/></label>}
      <button className="primary" disabled={busy}>{busy?'Please wait…':mode==='forgot'?'Send reset link':mode==='invite'?'Set password & accept invitation':mode==='reset'?'Update password':'Sign in'}<ArrowRight size={16}/></button>
    </fieldset></form>}
    {error&&<div className="error" role="alert">{error}</div>}{message&&<div className="info-note" role="status">{message}</div>}
    {mode==='login'&&<button className="text-button auth-link" disabled={busy} onClick={()=>{setMode('forgot');setError('');setMessage('')}}>Forgot your password?</button>}
    {mode==='forgot'&&<button className="text-button auth-link" disabled={busy} onClick={()=>{setMode('login');setError('');setMessage('')}}>Back to sign in</button>}
    {requiresSession&&validSession&&<button className="text-button auth-link" disabled={busy} onClick={async()=>{await supabase!.auth.signOut();window.location.assign('/login/')}}><LogOut size={13}/>Sign out</button>}
    <small className="auth-footer"><ShieldCheck size={12}/>Office access is controlled by your administrator.</small>
  </div></div>;
}
