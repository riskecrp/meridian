import { notFound } from 'next/navigation';
import '../forms.css';
import { formDef, FORM_KEYS } from '../../../lib/formDefs.js';
import PublicForm from './PublicForm.js';

// /forms/<key> — one hosted intake form. The definition (lib/formDefs.js) holds
// RegExps, which cannot cross the server/client boundary as props, so only the
// key is passed down and the client component looks the definition up itself.

export function generateStaticParams() { return FORM_KEYS.map((key) => ({ key })); }

export async function generateMetadata({ params }) {
  const { key } = await params;
  const def = formDef(key);
  return { title: def ? `${def.title} — Faction Management` : 'Form not found' };
}

export default async function FormPage({ params }) {
  const { key } = await params;
  if (!formDef(key)) notFound();
  return <PublicForm formKey={key} />;
}
