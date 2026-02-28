const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let tickets = [];
let callLog = [];

function parseSummary(summary, transcript, structuredData) {
  // Structured Output prüfen - suche nach it_support_summary egal unter welchem Key
  if (structuredData) {
    // Direkt als it_support_summary
    if (structuredData.it_support_summary) {
      const s = structuredData.it_support_summary;
      return {
        problem: s.problem || 'Problem nicht erfasst',
        loesung: s.loesung || 'Keine Empfehlung',
        schritte: s.schritte || 'Ticket zur weiteren Bearbeitung erstellt'
      };
    }
    // Als UUID-Key mit name: it_support_summary
    const keys = Object.keys(structuredData);
    for (const key of keys) {
      const entry = structuredData[key];
      if (entry?.name === 'it_support_summary' && entry?.result) {
        const s = entry.result;
        return {
          problem: s.problem || 'Problem nicht erfasst',
          loesung: s.loesung || 'Keine Empfehlung',
          schritte: s.schritte || 'Ticket zur weiteren Bearbeitung erstellt'
        };
      }
      // Direkt result mit problem/loesung/schritte
      if (entry?.problem || entry?.loesung) {
        return {
          problem: entry.problem || 'Problem nicht erfasst',
          loesung: entry.loesung || 'Keine Empfehlung',
          schritte: entry.schritte || 'Ticket zur weiteren Bearbeitung erstellt'
        };
      }
    }
  }

  // Fallback: Summary Text parsen
  const text = summary || transcript || '';
  const problemMatch = text.match(/PROBLEM:\s*(.+?)(?=LÖSUNG:|NÄCHSTE SCHRITTE:|$)/si);
  const loesungMatch = text.match(/LÖSUNG:\s*(.+?)(?=NÄCHSTE SCHRITTE:|PROBLEM:|$)/si);
  const schritteMatch = text.match(/NÄCHSTE SCHRITTE:\s*(.+?)(?=PROBLEM:|LÖSUNG:|$)/si);

  return {
    problem: problemMatch?.[1]?.trim() || summary?.substring(0, 300) || 'Problem nicht erfasst',
    loesung: loesungMatch?.[1]?.trim() || 'Siehe Transkript',
    schritte: schritteMatch?.[1]?.trim() || 'Ticket zur weiteren Bearbeitung erstellt'
  };
}

app.post('/webhook', async (req, res) => {
  const event = req.body;
  console.log('VAPI Event:', event.message?.type);
  console.log('Structured Data:', JSON.stringify(event.message?.analysis?.structuredData, null, 2));

  if (event.message?.type === 'end-of-call-report') {
    const call = event.message;
    const transcript = call.transcript || '';
    const summary    = call.summary || call.analysis?.summary || '';
    const duration   = Math.round((call.durationSeconds || 0));
    const caller     = call.customer?.number || 'Unbekannt';
    const startedAt  = call.startedAt || new Date().toISOString();

    const parsed = parseSummary(summary, transcript, call.analysis?.structuredData);

    const lower = (transcript + ' ' + summary + ' ' + parsed.problem).toLowerCase();

    let priority = 'medium';
    if (lower.includes('kritisch') || lower.includes('produktionsausfall') || lower.includes('dringend') || lower.includes('geht nicht mehr'))
      priority = 'critical';
    else if (lower.includes('fehler') || lower.includes('absturz') || lower.includes('funktioniert nicht') || lower.includes('passwort') || lower.includes('anmeldung') || lower.includes('gesperrt') || lower.includes('crash'))
      priority = 'high';
    else if (lower.includes('frage') || lower.includes('wie') || lower.includes('info'))
      priority = 'low';

    let category = 'Allgemein';
    if (lower.includes('netzwerk') || lower.includes('internet') || lower.includes('verbindung') || lower.includes('vpn'))
      category = 'Netzwerk';
    else if (lower.includes('passwort') || lower.includes('login') || lower.includes('zugang') || lower.includes('zugriff') || lower.includes('anmeldung') || lower.includes('gesperrt') || lower.includes('konto'))
      category = 'Zugang & Berechtigungen';
    else if (lower.includes('langsam') || lower.includes('performance') || lower.includes('lag'))
      category = 'Performance';
    else if (lower.includes('drucker') || lower.includes('hardware') || lower.includes('monitor'))
      category = 'Hardware';
    else if (lower.includes('software') || lower.includes('programm') || lower.includes('app') || lower.includes('outlook'))
      category = 'Software';

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
      category: 'Software', priority: 'medium'
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
