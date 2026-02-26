const express = require('express');
const cors = require('cors');
const app = express();


app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let tickets = [];
let callLog = [];

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

    const lower = (transcript + ' ' + summary).toLowerCase();
    let priority = 'medium';
    let category = 'Allgemein';

    if (lower.includes('kritisch') || lower.includes('produktionsausfall') || lower.includes('dringend') || lower.includes('geht nicht mehr'))
      priority = 'critical';
    else if (lower.includes('fehler') || lower.includes('absturz') || lower.includes('funktioniert nicht') || lower.includes('crash'))
      priority = 'high';
    else if (lower.includes('frage') || lower.includes('wie') || lower.includes('info'))
      priority = 'low';

    if (lower.includes('netzwerk') || lower.includes('internet') || lower.includes('verbindung') || lower.includes('vpn'))
      category = 'Netzwerk';
    else if (lower.includes('passwort') || lower.includes('login') || lower.includes('zugang') || lower.includes('zugriff'))
      category = 'Zugang & Berechtigungen';
    else if (lower.includes('langsam') || lower.includes('performance') || lower.includes('lag'))
      category = 'Performance';
    else if (lower.includes('drucker') || lower.includes('hardware') || lower.includes('monitor'))
      category = 'Hardware';
    else if (lower.includes('software') || lower.includes('programm') || lower.includes('app'))
      category = 'Software';

    const ticket = {
      id: 'TKT-' + String(tickets.length + 1).padStart(4, '0'),
      title: summary ? summary.split('.')[0].substring(0, 70) : 'Support-Anfrage via Telefon',
      description: summary || 'Kein Summary verfügbar.',
      transcript,
      category,
      priority,
      caller,
      duration,
      createdAt: startedAt,
      status: 'open'
    };

    tickets.unshift(ticket);
    callLog.unshift({ caller, duration, createdAt: startedAt, ticketId: ticket.id });
    console.log('✅ Ticket erstellt:', ticket.id);
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
      description: 'Der Anrufer berichtet, dass die VPN-Verbindung seit dem letzten Update regelmäßig nach ca. 10 Minuten getrennt wird. Neustart hilft kurzfristig, Problem kehrt zurück.',
      category: 'Netzwerk', priority: 'high',
      transcript: 'Agent: Guten Tag, IT-Support, mein Name ist Alex.\nKunde: Ja hallo, ich hab ein Problem mit meinem VPN...'
    },
    {
      title: 'Passwort nach Urlaub abgelaufen – kein Zugang',
      description: 'Mitarbeiterin kann sich nach 3-wöchigem Urlaub nicht mehr anmelden. Benötigt sofortigen Reset für Kundenpräsentation um 14 Uhr.',
      category: 'Zugang & Berechtigungen', priority: 'critical',
      transcript: 'Agent: Guten Tag, IT-Support.\nKunde: Ich brauche dringend Hilfe, ich komm nicht mehr rein...'
    },
    {
      title: 'Outlook lädt E-Mails extrem langsam',
      description: 'Seit dem Windows-Update von letzter Woche dauert das Laden der Inbox mehrere Minuten. Cache-Leerung wurde bereits versucht.',
      category: 'Performance', priority: 'medium',
      transcript: 'Agent: IT-Support, wie kann ich helfen?\nKunde: Mein Outlook ist seit einer Woche super langsam...'
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
