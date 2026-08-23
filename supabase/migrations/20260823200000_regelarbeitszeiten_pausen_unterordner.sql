-- Kundenwünsche 23.08.2026:
-- 1) Regelarbeitszeiten pro Wochentag admin-einstellbar (app_settings key 'regelarbeitszeiten')
-- 2) Pausen als Vormittag/Mittag-Minuten statt von/bis
-- 3) Unterordner (Arbeitsschritte) je Projekt, in Zeiterfassung wählbar

-- Unterordner je Projekt
CREATE TABLE IF NOT EXISTS public.project_subfolders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

ALTER TABLE public.project_subfolders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read subfolders"
  ON public.project_subfolders FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can create subfolders"
  ON public.project_subfolders FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can update subfolders"
  ON public.project_subfolders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Admins can delete subfolders"
  ON public.project_subfolders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'::app_role));

-- Zeiteinträge: Pausen-Detail + Unterordner
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS pause_vormittag_minutes integer,
  ADD COLUMN IF NOT EXISTS pause_mittag_minutes integer,
  ADD COLUMN IF NOT EXISTS subfolder_id uuid REFERENCES public.project_subfolders(id) ON DELETE SET NULL;

-- Default-Regelarbeitszeiten (Mo-Fr 06:30-15:30, Mittagspause 60 min) hinterlegen,
-- falls noch keine gesetzt wurden. Format: {"1": Mo ... "5": Fr}
INSERT INTO public.app_settings (key, value)
VALUES (
  'regelarbeitszeiten',
  '{"1":{"start":"06:30","end":"15:30","pauseVormittag":0,"pauseMittag":60},"2":{"start":"06:30","end":"15:30","pauseVormittag":0,"pauseMittag":60},"3":{"start":"06:30","end":"15:30","pauseVormittag":0,"pauseMittag":60},"4":{"start":"06:30","end":"15:30","pauseVormittag":0,"pauseMittag":60},"5":{"start":"06:30","end":"15:30","pauseVormittag":0,"pauseMittag":60}}'
)
ON CONFLICT (key) DO NOTHING;
