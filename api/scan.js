// Vercel serverless function: reads a photo of a Padma Hostel paper application form with Google Gemini
// and returns the filled-in values as JSON. Runs on Vercel, so the Gemini key never reaches the browser
// or GitHub.
//
// Needs two Environment Variables in Vercel (Project → Settings → Environment Variables):
//   GEMINI_API_KEY  – from https://aistudio.google.com/apikey
//   SCAN_PIN        – any PIN you choose; the app asks for it once, so strangers can't use your free quota
// Optional: GEMINI_MODEL – to force one model (otherwise the list below is tried in order).

const crypto = require('crypto');

const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const FIELDS = {
  formNo: 'Form No. printed/written at top left',
  applicationDate: 'the "Date:" at top right (date the form was filled)',
  name: "Student's name in capital English letters (join the letter boxes into words)",
  nameNepali: "Student's name in Nepali (Devanagari) exactly as written",
  dob: 'Date of Birth exactly as written',
  phone: "Student's contact number (digits only)",
  email: 'E-mail address (may be written anywhere near the e-mail box)',
  district: 'Address: District',
  municipality: 'Metro/Sub-Metro/Rural/Municipality',
  ward: 'Ward No.',
  street: 'Street Name/Tole/Chowk',
  citizenship: 'Citizenship No./Date of Issue/Place exactly as written',
  institute: 'Name of the Educational Institute',
  classTime: 'Class Time',
  level: 'Level of Study',
  stayDuration: 'Time duration to stay in the hostel',
  bloodGroup: 'Blood Group, normalised to one of A+ A- B+ B- AB+ AB- O+ O-',
  food: 'which food box is ticked: exactly "Vegetarian", "Only Egg" or "Non-Vegetarian"',
  health: 'Mention the disease (if any)',
  fatherName: "Father's Name", fatherPhone: "Father's Contact No. (digits only)", fatherOccupation: "Father's Occupation",
  motherName: "Mother's Name", motherPhone: "Mother's Contact No. (digits only)", motherOccupation: "Mother's Occupation",
  spouseName: 'Spouse Name', spousePhone: 'Spouse Contact No.', spouseOccupation: 'Spouse Occupation',
  guardianName: 'Name of the Local Guardian', guardianAddress: "Local guardian's Address", guardianPhone: "Local guardian's Contact No. (digits only)",
  guardianOccupation: "Local guardian's Occupation", relation: 'Relation of the local guardian',
  bookingDate: 'Official box: Booking Date', roomNo: 'Official box: Room No.', monthlyFee: 'Official box: Monthly Fee (number only)',
  admissionDate: 'Official box: Admission Date', approvedBy: 'Official box: Approved by – Name',
  hostelName: 'the hostel name printed at the top (e.g. PADMA BOYS HOSTEL / PADMA GIRLS HOSTEL)',
};

function schema() {
  const props = {};
  for (const k of Object.keys(FIELDS)) props[k] = { type: 'STRING', description: FIELDS[k] };
  props.dateCalendar = { type: 'STRING', description: 'For dob/applicationDate/bookingDate/admissionDate: "AD" if the years look like 19xx/20xx A.D., "BS" if they look like 20xx B.S. (2040-2099), else "unknown"' };
  props.unsure = { type: 'ARRAY', items: { type: 'STRING' }, description: 'names of fields whose handwriting was hard to read or is a guess' };
  return { type: 'OBJECT', properties: props, required: Object.keys(props) };
}

const PROMPT = `You are reading a photo of a hand-filled "Student Application Form" of Padma Hostel, Lalitpur, Nepal.
Extract what is written in each field. Rules:
- Copy values exactly as written; fix only obvious letter-box spacing (e.g. "A R U N  P O U D E L" -> "ARUN POUDEL").
- Use "" for empty boxes, dashes ("-", "—") or "N/A". Never invent values.
- Phone numbers: digits only, no spaces.
- Dates: give them exactly as written (e.g. "02/01/2004", "2080-05-12") and set dateCalendar.
- If a value is hard to read, give your best reading and list the field name in "unsure".`;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function callGemini(model, key, mime, data) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema() },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((body.error && body.error.message) || `Gemini error ${r.status}`); e.status = r.status; throw e; }
  const text = (((body.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
  return JSON.parse(text);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const key = process.env.GEMINI_API_KEY, pin = process.env.SCAN_PIN;
  if (!key || !pin) return res.status(503).json({ error: 'The scanner is not set up yet: add GEMINI_API_KEY and SCAN_PIN in Vercel → Settings → Environment Variables, then redeploy.' });
  const b = req.body || {};
  if (!safeEqual(b.pin || '', pin)) { await new Promise((r) => setTimeout(r, 800)); return res.status(401).json({ error: 'Wrong scan PIN.' }); }
  const mime = String(b.mime || '');
  const data = String(b.image || '');
  if (!/^image\/(jpeg|png|webp)$/.test(mime) || data.length < 1000 || data.length > 6_000_000) return res.status(400).json({ error: 'Please send a JPG or PNG photo of the form.' });

  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : MODELS;
  let last;
  for (const m of models) {
    try {
      const fields = await callGemini(m, key, mime, data);
      return res.status(200).json({ ok: true, model: m, fields });
    } catch (e) {
      last = e;
      // model not available for this key / quota used up for this model → try the next one
      if (![400, 403, 404, 429].includes(e.status)) break;
    }
  }
  const quota = last && last.status === 429;
  return res.status(quota ? 429 : 502).json({ error: quota ? 'The free Gemini limit for today is used up. Try again tomorrow (it resets at about 1:45 PM Nepal time).' : 'Could not read the form: ' + (last ? last.message : 'unknown error') });
};
