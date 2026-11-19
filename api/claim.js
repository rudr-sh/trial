import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const team = String(req.body?.team || '').trim();
  const problemId = Number(req.body?.problemId);
  if (!team || !Number.isInteger(problemId))
    return res.status(400).json({ error: 'Bad request' });

  const safe = team.replace(/[%_\\]/g, '\\$&');
  const { data: t } = await supabase
    .from('teams').select('name, theme, problem_id').ilike('name', safe).maybeSingle();
  if (!t) return res.status(404).json({ error: 'Team not found' });
  if (t.problem_id)
    return res.status(409).json({ error: 'Your team already chose a problem statement' });

  const { data: lock } = await supabase
    .from('teams').update({ problem_id: problemId })
    .eq('name', t.name).is('problem_id', null).select();
  if (!lock || lock.length === 0)
    return res.status(409).json({ error: 'Your team already chose a problem statement' });

  const { data: claimed } = await supabase
    .from('problems').update({ claimed_by: t.name })
    .eq('id', problemId).eq('theme', t.theme).is('claimed_by', null).select();

  if (!claimed || claimed.length === 0) {
    await supabase.from('teams').update({ problem_id: null }).eq('name', t.name);
    return res.status(409).json({ error: 'Sorry, that problem was just taken. Pick another.' });
  }

  res.json({ ok: true, problem: claimed[0].title });
}