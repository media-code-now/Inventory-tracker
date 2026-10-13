import type { Metadata } from 'next';
import './globals.css';
import DiagnosticListener from '../components/diagnostic-listener';
export const metadata: Metadata = { title: 'Stockroom | Office inventory', description: 'Private office inventory management' };
export default function Layout({ children }: {children: React.ReactNode}) { return <html lang="en"><body><DiagnosticListener/>{children}</body></html>; }
