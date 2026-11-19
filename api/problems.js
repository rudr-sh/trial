import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = keyOf(req.query.team);
  if (!key) return res.status(400).json({ error: 'Team name required' });

  const { data: t } = await supabase
    .from('teams').select('name, theme, problem_id').eq('name_key', key).maybeSingle();
  if (!t) return res.status(404).json({ error: 'Team not found. Check your team name.' });

  if (t.problem_id) {
    const { data: p } = await supabase
      .from('problems').select('id, title').eq('id', t.problem_id).single();
    return res.json({ team: t.name, theme: t.theme, claimed: p });
  }

  const { data: problems } = await supabase
    .from('problems').select('id, title')
    .eq('theme', t.theme).is('claimed_by', null).order('id');

  res.json({ team: t.name, theme: t.theme, problems: problems || [] });
}