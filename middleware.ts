import {NextRequest,NextResponse} from 'next/server';
import {settings,validSession} from './lib/office-server';
export async function middleware(request:NextRequest){
 let response:NextResponse;
 try{
  const s=settings();
  if(process.env.NODE_ENV==='production'&&request.nextUrl.protocol!=='https:'&&request.headers.get('x-forwarded-proto')!=='https'){
   return new NextResponse('HTTPS required',{status:426});
  }
  const path=request.nextUrl.pathname.replace(/\/$/,'')||'/';
  const publicPath=['/office-unlock','/api/office/login','/api/office/logout','/robots.txt'].includes(path)||path.startsWith('/_next/static/');
  if(!publicPath&&!await validSession(request)){
   response=path.startsWith('/api/')?NextResponse.json({error:'Office authorization required'},{status:401}):NextResponse.redirect(new URL('/office-unlock/?next='+encodeURIComponent(request.nextUrl.pathname+request.nextUrl.search),s.origin));
  }else response=NextResponse.next();
 }catch{response=new NextResponse('Office access is temporarily unavailable',{status:503});}
 response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('Referrer-Policy','same-origin');
 response.headers.set('X-Content-Type-Options','nosniff');
 if(process.env.NODE_ENV==='production')response.headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 return response;
}
export const config={matcher:['/:path*'],runtime:'nodejs'};
