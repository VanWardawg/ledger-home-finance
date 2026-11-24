// A stand-in for VIPKid's calendar server, for testing the class sync locally.
// Usage: MOCK_USER=... MOCK_PASS=... node mockcaldav.mjs <port>
import http from 'node:http';
const port = Number(process.argv[2]) || 4390;
const user = process.env.MOCK_USER, pass = process.env.MOCK_PASS;
const want = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const pad = (n) => String(n).padStart(2, '0');

// Six 25-minute classes each evening (Beijing time) Monday to Saturday, from
// ten weeks back to two weeks ahead, plus one 50-minute class each Sunday.
function events() {
  const out = [];
  const start = new Date(Date.now() - 70 * 86400000);
  for (let i = 0; i < 84; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    if (d.getUTCDay() === 0) {
      out.push(`BEGIN:VEVENT\r\nUID:long-${ymd}\r\nSUMMARY:VIPKid class (50 min)\r\nDTSTART;TZID=Asia/Shanghai:${ymd}T190000\r\nDTEND;TZID=Asia/Shanghai:${ymd}T195000\r\nEND:VEVENT`);
      continue;
    }
    for (let k = 0; k < 6; k++) {
      const hh = 18 + Math.floor(k / 2), mm = k % 2 ? 30 : 0;
      out.push(`BEGIN:VEVENT\r\nUID:c-${ymd}-${k}\r\nSUMMARY:VIPKid class\r\nDTSTART;TZID=Asia/Shanghai:${ymd}T${pad(hh)}${pad(mm)}00\r\nDURATION:PT25M\r\nEND:VEVENT`);
    }
    if (i % 9 === 0) out.push(`BEGIN:VEVENT\r\nUID:x-${ymd}\r\nSUMMARY:Cancelled class\r\nSTATUS:CANCELLED\r\nDTSTART;TZID=Asia/Shanghai:${ymd}T210000\r\nDURATION:PT25M\r\nEND:VEVENT`);
  }
  return out;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

http.createServer((req, res) => {
  if (req.headers.authorization !== want) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="sabre/dav"' }); return res.end(); }
  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
  if (req.method === 'PROPFIND') {
    return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/dav.php/calendars/${user}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/dav.php/calendars/${user}/default/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/dav.php/calendars/${user}/inbox/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:schedule-inbox/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`);
  }
  if (req.method === 'REPORT') {
    const body = events().map((e, i) => `<d:response><d:href>/dav.php/calendars/${user}/default/${i}.ics</d:href><d:propstat><d:prop><cal:calendar-data>${esc(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${e}\r\nEND:VCALENDAR\r\n`)}</cal:calendar-data></d:prop></d:propstat></d:response>`).join('\n');
    return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`);
  }
  res.end();
}).listen(port, '127.0.0.1', () => console.log('mock calendar on', port));
