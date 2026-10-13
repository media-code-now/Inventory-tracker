import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Stockroom | Office inventory', description: 'Private office inventory management' };
export default function Layout({ children }: {children: React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
