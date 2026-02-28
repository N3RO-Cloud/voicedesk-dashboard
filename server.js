const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let tickets = [];
let callLog = [];

// Extrahiert strukturiertes Summary aus dem VAPI Summary Text
function parseSummary(summary, transcript) {
  const text = summary || transcript || '';
  
  let problem = '';
  let loesung = '';
  let schritte = '';

  // Versuche strukturiertes Format zu parsen (PROBLEM: / LÖSUNG: / NÄCHSTE SCHRITTE:)
  const problemMatch = text.match(/PROBLEM:\s*(.+?)(?=LÖSUNG:|NÄCHSTE SCHRITTE:|$)/si);
  const loesungMatch = text.match(/LÖSUNG:\s*(.+?)(?=NÄCHSTE SCHRITTE:|PROBLEM:|$)/si);
  const schritteMatch = text.match(/NÄCHSTE SCHRITTE:\s*(.+?)(?=PROBLEM:|LÖSUNG:|$)/si);

  if (problemMatch) problem = problemMatch[1].trim();
  if (loesungMatch) loesung = loesungMatch[1].trim();
  if (schritteMatch) schritte = schritteMatch[1].trim();

  // Fallback: Nutze das komplette Summary wenn kein strukturiertes Format gefunden
  if (!problem && summary) {
    problem = summary.substring(0, 300);
  }

  // Letzter Fallback: Extrahiere aus Transkript
  if (!problem && transcript) {
    const lines = transcript.split('\n').filter(l => l.toLowerCase().includes('user:'));
    problem = lines.slice(0, 3).map(l => l.replace(/user:/i, '').trim()).join(' ');
    if (problem.length > 300) problem = problem.substring(0, 300) + '...';
  }

  return {
    problem: problem || 'Problem nicht erfasst',
    loesung: loesung || 'Siehe Transkript',
    schritte: schritte || 'Ticket wurde zur weiteren Bearbeitung erstellt'
  };
}

app.post('/webhook', async (req, res) => {
  const event = req.body;
  console.log('VAPI Event:', event.message?.type);

  if (event.message?.type === 'end-of-call-report') {
    const call = event.message;
    const transcript = call.transcript || '';
    const summary    = call.summary || call.analysis?.summary || '';
    const duration   = Math.round((call.durationSeconds || 0));
    const caller     = call.customer?.number || 'Unbekannt';
    const startedAt  = call.startedAt || new Date().toISOString();

    const parsed = parseSummary(summary, transcript);

    const lower = (transcript + ' ' + summary).toLowerCase();

    // Priorität
    let priority = 'medium';
    if (lower.includes('kritisch') || lower.includes('produktionsausfall') || lower.includes('dringend') || lower.includes('geht nicht mehr'))
      priority = 'critical';
    else if (lower.includes('fehler') || lower.includes('absturz') || lower.includes('funktioniert nicht') || lower.includes('passwort') || lower.includes('anmeldung') || lower.includes('crash'))
      priority = 'high';
    else if (lower.includes('frage') || lower.includes('wie') || lower.includes('info'))
      priority = 'low';

    // Kategorie
    let category = 'Allgemein';
    if (lower.includes('netzwerk') || lower.includes('internet') || lower.includes('verbindung') || lower.includes('vpn'))
      category = 'Netzwerk';
    else if (lower.includes('passwort') || lower.includes('login') || lower.includes('zugang') || lower.includes('zugriff') || lower.includes('anmeldung'))
      category = 'Zugang & Berechtigungen';
    else if (lower.includes('langsam') || lower.includes('performance') || lower.includes('lag'))
      category = 'Performance';
    else if (lower.includes('drucker') || lower.includes('hardware') || lower.includes('monitor'))
      category = 'Hardware';
    else if (lower.includes('software') || lower.includes('programm') || lower.includes('app'))
      category = 'Software';

    // Titel aus Problem ableiten
    const title = parsed.problem.split('.')[0].substring(0, 70) || 'Support-Anfrage via Telefon';

    const ticket = {
      id: 'TKT-' + String(tickets.length + 1).padStart(4, '0'),
      title,
      problem: parsed.problem,
      loesung: parsed.loesung,
      schritte: parsed.schritte,
      category,
      priority,
      caller,
      duration,
      createdAt: startedAt,
      status: 'open'
    };

    tickets.unshift(ticket);
    callLog.unshift({ caller, duration, createdAt: startedAt, ticketId: ticket.id });
    console.log('✅ Ticket erstellt:', ticket.id, '|', title);
  }

  res.status(200).json({ received: true });
});

app.get('/api/tickets', (req, res) => res.json(tickets));

app.get('/api/stats', (req, res) => {
  res.json({
    total: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    critical: tickets.filter(t => t.priority === 'critical').length,
    high: tickets.filter(t => t.priority === 'high').length,
    calls: callLog.length
  });
});

app.patch('/api/tickets/:id', (req, res) => {
  const ticket = tickets.find(t => t.id === req.params.id);
  if (ticket) {
    Object.assign(ticket, req.body);
    res.json(ticket);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/demo-ticket', (req, res) => {
  const demos = [
    {
      title: 'VPN-Verbindung bricht nach 10 Minuten ab',
      problem: 'Der Anrufer berichtet, dass die VPN-Verbindung seit dem letzten Update regelmäßig nach ca. 10 Minuten getrennt wird.',
      loesung: 'VPN-Client neu installieren und auf Version 5.2 updaten. Netzwerktreiber ebenfalls aktualisieren.',
      schritte: '1. VPN-Client deinstallieren\n2. Neueste Version von IT-Portal herunterladen\n3. Nach Installation neu starten\n4. Bei weiterem Problem: Ticket eskalieren',
      category: 'Netzwerk', priority: 'high'
    },
    {
      title: 'Passwort nach Urlaub abgelaufen',
      problem: 'Mitarbeiterin kann sich nach 3-wöchigem Urlaub nicht mehr anmelden. Benötigt sofortigen Reset für Kundenpräsentation um 14 Uhr.',
      loesung: 'Passwort-Reset über Active Directory wurde eingeleitet. Temporäres Passwort wurde kommuniziert.',
      schritte: '1. Mit temporärem Passwort anmelden\n2. Passwort sofort ändern\n3. Bei Problemen: IT-Helpdesk Durchwahl 101',
      category: 'Zugang & Berechtigungen', priority: 'critical'
    },
    {
      title: 'Outlook lädt E-Mails extrem langsam',
      problem: 'Seit dem Windows-Update von letzter Woche dauert das Laden der Inbox mehrere Minuten. Cache-Leerung wurde bereits versucht.',
      loesung: 'Outlook-Profil neu erstellen und OST-Datei löschen. Problem tritt nach großem Update häufiger auf.',
      schritte: '1. Outlook schließen\n2. OST-Datei unter AppData löschen\n3. Outlook neu starten und synchronisieren lassen\n4. Dauer: ca. 20 Minuten',
      category: 'Performance', priority: 'medium'
    }
  ];

  const demo = demos[tickets.length % demos.length];
  const ticket = {
    id: 'TKT-' + String(tickets.length + 1).padStart(4, '0'),
    ...demo,
    caller: '+49 ' + Math.floor(Math.random()*900+100) + ' ' + Math.floor(Math.random()*9000000+1000000),
    duration: Math.floor(Math.random() * 240 + 60),
    createdAt: new Date().toISOString(),
    status: 'open'
  };
  tickets.unshift(ticket);
  res.json(ticket);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard läuft auf Port ${PORT}`));
