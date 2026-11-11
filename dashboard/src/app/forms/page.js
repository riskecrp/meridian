import Link from 'next/link';
import './forms.css';
import { FORM_DEFS } from '../../lib/formDefs.js';

// /forms — the public index of the hosted intake forms. No login: these are
// filled in by players and applicants. Submissions land in the same records and
// Discord threads the Google Forms used to feed (see ./actions.js).

export const metadata = { title: 'Faction Management — Forms', description: 'Applications, requests and feedback for ECRP Faction Management.' };

export default function FormsIndex() {
  return (
    <main className="pf-page">
      <div className="pf-wrap">
        <div className="pf-brand">
          <div className="pf-logo">Meridian</div>
          <div className="pf-sub">Faction Management</div>
        </div>
        <h1 className="pf-title" style={{ textAlign: 'center' }}>Forms</h1>
        <p className="pf-intro" style={{ textAlign: 'center' }}>Applications, requests and feedback for the Criminal Faction Management team. Pick the form you need; every submission reaches the team in Discord.</p>
        <ul className="pf-list">
          {FORM_DEFS.map((f) => (
            <li key={f.key}>
              <Link href={`/forms/${f.key}`} className="pf-item">
                <div className="pf-item-title">{f.title}</div>
                <div className="pf-item-intro">{f.intro}</div>
              </Link>
            </li>
          ))}
        </ul>
        <p className="pf-foot">Faction Management staff: <a href="/login">sign in to the dashboard</a>.</p>
      </div>
    </main>
  );
}
