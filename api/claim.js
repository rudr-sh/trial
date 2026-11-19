import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = keyOf(req.body?.team);
  const problemId = Number(req.body?.problemId);
  if (!key || !Number.isInteger(problemId))
    return res.status(400).json({ error: 'Bad request' });

  const { data, error } = await supabase.rpc('claim_problem', { p_key: key, p_problem: problemId });
  if (error) return res.status(500).json({ error: 'Server busy, please try again.' });

  if (data.status === 'ok') return res.json({ ok: true, problem: data.title });
  if (data.status === 'taken')
    return res.status(409).json({ error: 'Sorry, that problem was just taken. Pick another.' });
  if (data.status === 'already')
    return res.status(409).json({ error: 'Your team already chose a problem statement.' });
  return res.status(404).json({ error: 'Team not found' });
}