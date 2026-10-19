import type { Metadata, Viewport } from 'next';
import './globals.css';
import OfficeLogout from '../components/office-logout';
import DiagnosticListener from '../components/diagnostic-listener';
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f2f4f8' };
export const metadata: Metadata = { title: 'Stockroom | Office inventory', description: 'Private office inventory management', robots: {index:false,follow:false} };
export default function Layout({ children }: {children: React.ReactNode}) { return <html lang="en"><body><DiagnosticListener/><OfficeLogout/>{children}</body></html>; }
