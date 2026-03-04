-- ============================================================
-- HANDWERKSAPP - Konsolidiertes Datenbankschema
-- ============================================================
-- Dieses File enthält das vollständige Datenbankschema.
-- Für ein neues Projekt: Dieses SQL in deinem Supabase SQL Editor ausführen.
-- 
-- REIHENFOLGE WICHTIG: Migrations werden chronologisch zusammengeführt.
-- ============================================================

-- Create role enum
CREATE TYPE public.app_role AS ENUM ('administrator', 'mitarbeiter');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vorname TEXT NOT NULL,
  nachname TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create projects table
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  beschreibung TEXT,
  adresse TEXT,
  status TEXT DEFAULT 'aktiv',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Create time entries table
CREATE TABLE public.time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  datum DATE NOT NULL,
  stunden DECIMAL(5,2) NOT NULL,
  taetigkeit TEXT NOT NULL,
  notizen TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Create documents table (for plans, photos, delivery notes, etc.)
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  typ TEXT NOT NULL, -- 'plan', 'foto', 'lieferschein', 'material'
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  beschreibung TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Create reports table (Regieberichte)
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  datum DATE NOT NULL,
  beschreibung TEXT NOT NULL,
  arbeitszeit DECIMAL(5,2) NOT NULL,
  unterschrift_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

-- RLS Policies for projects
CREATE POLICY "Authenticated users can view projects"
  ON public.projects FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert projects"
  ON public.projects FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update projects"
  ON public.projects FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete projects"
  ON public.projects FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));

-- RLS Policies for time_entries
CREATE POLICY "Users can view own time entries"
  ON public.time_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all time entries"
  ON public.time_entries FOR SELECT
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "Users can insert own time entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own time entries"
  ON public.time_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own time entries"
  ON public.time_entries FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for documents
CREATE POLICY "Authenticated users can view documents"
  ON public.documents FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert documents"
  ON public.documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
  ON public.documents FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete all documents"
  ON public.documents FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));

-- RLS Policies for reports
CREATE POLICY "Authenticated users can view reports"
  ON public.reports FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
  ON public.reports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can update all reports"
  ON public.reports FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

-- Trigger for profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, vorname, nachname)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', '')
  );
  
  -- First user becomes administrator, others become mitarbeiter
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE 
      WHEN (SELECT COUNT(*) FROM auth.users) = 1 THEN 'administrator'::app_role
      ELSE 'mitarbeiter'::app_role
    END
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_time_entries_updated_at
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();-- Update the handle_new_user trigger to also create a profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
  assigned_role app_role;
BEGIN
  -- Count existing users
  SELECT COUNT(*) INTO user_count FROM auth.users;
  
  -- First user becomes administrator, others become mitarbeiter
  IF user_count = 1 THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  -- Insert into user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- Insert into profiles with data from sign up metadata
  INSERT INTO public.profiles (id, vorname, nachname)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', '')
  );
  
  RETURN NEW;
END;
$$;

-- Update RLS policy for user_roles to allow admins to update
CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
USING (has_role(auth.uid(), 'administrator'::app_role));-- Fix the function search path issue by ensuring all functions have proper search_path set
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;-- Update handle_new_user function so new users are mitarbeiter by default
-- Only the very first user becomes administrator
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_count INTEGER;
  assigned_role app_role;
BEGIN
  -- Count existing users (excluding the current one being created)
  SELECT COUNT(*) INTO user_count FROM auth.users WHERE id != NEW.id;
  
  -- First user (user_count = 0) becomes administrator, all others become mitarbeiter
  IF user_count = 0 THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  -- Insert into user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- Insert into profiles with data from sign up metadata
  INSERT INTO public.profiles (id, vorname, nachname)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', '')
  );
  
  RETURN NEW;
END;
$function$;-- Enable realtime for projects and time_entries
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;

-- Create storage buckets for project documents
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('project-plans', 'project-plans', false),
  ('project-reports', 'project-reports', false),
  ('project-photos', 'project-photos', true),
  ('project-materials', 'project-materials', false);

-- Storage policies for project-plans
CREATE POLICY "Authenticated users can view project plans"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-plans' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload project plans"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-plans' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project plans"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-plans' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project plans"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-plans' AND has_role(auth.uid(), 'administrator'::app_role));

-- Storage policies for project-reports
CREATE POLICY "Authenticated users can view project reports"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-reports' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload project reports"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-reports' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project reports"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-reports' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project reports"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-reports' AND has_role(auth.uid(), 'administrator'::app_role));

-- Storage policies for project-photos (public bucket)
CREATE POLICY "Anyone can view project photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-photos');

CREATE POLICY "Authenticated users can upload project photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-photos' AND has_role(auth.uid(), 'administrator'::app_role));

-- Storage policies for project-materials
CREATE POLICY "Authenticated users can view project materials"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-materials' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload project materials"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-materials' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update project materials"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-materials' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete project materials"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-materials' AND has_role(auth.uid(), 'administrator'::app_role));-- Drop old restrictive policy
DROP POLICY IF EXISTS "Admins can insert projects" ON public.projects;

-- Allow all authenticated users to create projects
CREATE POLICY "Authenticated users can insert projects"
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);-- Create persistent role override table so admins can test roles without changing base role
create table public.user_role_overrides (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  override_role app_role not null,
  updated_at timestamptz not null default now()
);

alter table public.user_role_overrides enable row level security;

-- Policies: users can view their own override, admins can view all
create policy "Users can view own role override"
  on public.user_role_overrides for select
  using (auth.uid() = user_id);

create policy "Admins can view all role overrides"
  on public.user_role_overrides for select
  using (public.has_role(auth.uid(), 'administrator'));

-- Only admins may insert/update/delete overrides
create policy "Admins can insert role overrides"
  on public.user_role_overrides for insert
  with check (public.has_role(auth.uid(), 'administrator'));

create policy "Admins can update role overrides"
  on public.user_role_overrides for update
  using (public.has_role(auth.uid(), 'administrator'))
  with check (public.has_role(auth.uid(), 'administrator'));

create policy "Admins can delete role overrides"
  on public.user_role_overrides for delete
  using (public.has_role(auth.uid(), 'administrator'));

-- Trigger to keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger user_role_overrides_touch
before update on public.user_role_overrides
for each row execute function public.touch_updated_at();-- Adjust user_role_overrides policies to allow safe self upsert
-- Drop previous admin-only write policies
DROP POLICY IF EXISTS "Admins can insert role overrides" ON public.user_role_overrides;
DROP POLICY IF EXISTS "Admins can update role overrides" ON public.user_role_overrides;
DROP POLICY IF EXISTS "Admins can delete role overrides" ON public.user_role_overrides;

-- Insert: users can set their own override to 'mitarbeiter', admins can set any (including 'administrator')
CREATE POLICY "Users can insert own override (mitarbeiter) or admin any"
ON public.user_role_overrides
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND (
    override_role = 'mitarbeiter'::app_role
    OR public.has_role(auth.uid(), 'administrator'::app_role)
  )
);

-- Update: same rule, must be their own row
CREATE POLICY "Users can update own override (mitarbeiter) or admin any"
ON public.user_role_overrides
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (
    override_role = 'mitarbeiter'::app_role
    OR public.has_role(auth.uid(), 'administrator'::app_role)
  )
);

-- Delete: allow user to clear own override, admins can clear any
CREATE POLICY "Users can delete own override or admin any"
ON public.user_role_overrides
FOR DELETE
USING (
  auth.uid() = user_id OR public.has_role(auth.uid(), 'administrator'::app_role)
);
-- Add anleitung_completed field to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS anleitung_completed boolean DEFAULT false;

-- Create invitation_logs table for tracking SMS invitations
CREATE TABLE IF NOT EXISTS invitation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefonnummer text NOT NULL,
  gesendet_am timestamp with time zone DEFAULT now(),
  gesendet_von uuid REFERENCES auth.users(id),
  status text DEFAULT 'gesendet'
);

-- Enable Row Level Security
ALTER TABLE invitation_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view invitations
CREATE POLICY "Admins can view invitations"
ON invitation_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'administrator'::app_role));

-- Only admins can insert invitations
CREATE POLICY "Admins can insert invitations"
ON invitation_logs
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'administrator'::app_role));-- Testumgebung: Ermögliche allen Benutzern freien Rollenwechsel
-- Alte restriktive Policies löschen
DROP POLICY IF EXISTS "Users can insert own override (mitarbeiter) or admin any" ON public.user_role_overrides;
DROP POLICY IF EXISTS "Users can update own override (mitarbeiter) or admin any" ON public.user_role_overrides;

-- Neue permissive Policies für Testzwecke erstellen
-- Jeder authentifizierte User kann seine Override-Rolle frei wählen
CREATE POLICY "Users can insert any override for testing"
ON public.user_role_overrides
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update any override for testing"
ON public.user_role_overrides
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);-- Erweitere time_entries Tabelle für detaillierte Zeiterfassung
ALTER TABLE time_entries
ADD COLUMN start_time time,
ADD COLUMN end_time time,
ADD COLUMN pause_minutes integer DEFAULT 0,
ADD COLUMN location_type text DEFAULT 'baustelle' CHECK (location_type IN ('baustelle', 'werkstatt'));

-- Mache project_id optional für Werkstatt-Einträge
ALTER TABLE time_entries
ALTER COLUMN project_id DROP NOT NULL;

-- Kommentar für Dokumentation
COMMENT ON COLUMN time_entries.start_time IS 'Startzeit der Arbeit';
COMMENT ON COLUMN time_entries.end_time IS 'Endzeit der Arbeit';
COMMENT ON COLUMN time_entries.pause_minutes IS 'Pausenzeit in Minuten';
COMMENT ON COLUMN time_entries.location_type IS 'Arbeitsort: baustelle oder werkstatt (für Diätenberechnung)';-- Phase 1: Storage Bucket Limits auf 50 MB erhöhen
UPDATE storage.buckets 
SET file_size_limit = 52428800 
WHERE id IN ('project-plans', 'project-reports', 'project-photos', 'project-materials');

-- Phase 3: Mitarbeiter-Stammdaten Tabelle
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Persönliche Daten
  vorname text NOT NULL,
  nachname text NOT NULL,
  geburtsdatum date,
  
  -- Kontaktdaten
  adresse text,
  plz text,
  ort text,
  land text DEFAULT 'Österreich',
  telefon text,
  email text,
  
  -- Arbeitsrechtliche Daten
  sv_nummer text,
  eintritt_datum date,
  austritt_datum date,
  position text DEFAULT 'Mitarbeiter',
  beschaeftigung_art text,
  stundenlohn numeric(10, 2),
  
  -- Bankverbindung
  iban text,
  bic text,
  bank_name text,
  
  -- Arbeitskleidung
  kleidungsgroesse text,
  schuhgroesse text,
  
  -- Sonstiges
  notizen text,
  
  -- Metadaten
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Admins können alles sehen und bearbeiten
CREATE POLICY "Admins can view all employees"
  ON public.employees FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert employees"
  ON public.employees FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update employees"
  ON public.employees FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete employees"
  ON public.employees FOR DELETE
  USING (has_role(auth.uid(), 'administrator'));

-- Mitarbeiter können nur ihre eigenen Daten lesen
CREATE POLICY "Users can view own employee data"
  ON public.employees FOR SELECT
  USING (auth.uid() = user_id);

-- Trigger für updated_at
CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Storage Bucket für Mitarbeiter-Dokumente
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('employee-documents', 'employee-documents', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies für employee-documents
CREATE POLICY "Admins can upload employee documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents' 
    AND has_role(auth.uid(), 'administrator')
  );

CREATE POLICY "Admins can view all employee documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents' 
    AND has_role(auth.uid(), 'administrator')
  );

CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Admins can delete employee documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'employee-documents' 
    AND has_role(auth.uid(), 'administrator')
  );-- PLZ als separates Pflichtfeld zur projects-Tabelle hinzufügen
ALTER TABLE public.projects 
ADD COLUMN plz text;

-- Für bestehende Projekte PLZ aus Adresse extrahieren (wenn möglich)
UPDATE public.projects 
SET plz = substring(adresse FROM '\d{4,5}')
WHERE adresse IS NOT NULL AND plz IS NULL;

-- Standardwert für Projekte ohne PLZ in der Adresse
UPDATE public.projects 
SET plz = '0000'
WHERE plz IS NULL;

-- PLZ für neue Projekte verpflichtend machen
ALTER TABLE public.projects 
ALTER COLUMN plz SET NOT NULL;-- 1. DATENBEREINIGUNG: Alte Einträge mit Standardwerten füllen (mit korrektem Type Casting)
UPDATE time_entries
SET 
  start_time = '07:30:00'::time,
  end_time = CASE 
    WHEN EXTRACT(DOW FROM datum) = 5 THEN '12:30:00'::time  -- Freitag
    ELSE '17:00:00'::time  -- Montag-Donnerstag
  END,
  pause_minutes = CASE 
    WHEN EXTRACT(DOW FROM datum) = 5 THEN 0  -- Freitag
    ELSE 60  -- Montag-Donnerstag
  END
WHERE start_time IS NULL OR end_time IS NULL OR pause_minutes IS NULL;

-- 2. NOT NULL CONSTRAINTS hinzufügen
ALTER TABLE time_entries 
ALTER COLUMN start_time SET NOT NULL;

ALTER TABLE time_entries 
ALTER COLUMN end_time SET NOT NULL;

ALTER TABLE time_entries 
ALTER COLUMN pause_minutes SET DEFAULT 0;

ALTER TABLE time_entries 
ALTER COLUMN pause_minutes SET NOT NULL;

-- 3. CHECK CONSTRAINTS für logische Validierung
ALTER TABLE time_entries
ADD CONSTRAINT check_time_order 
CHECK (end_time > start_time);

ALTER TABLE time_entries
ADD CONSTRAINT check_pause_positive 
CHECK (pause_minutes >= 0);-- Storage-Policies für employee-documents Bucket korrigieren

-- Alte Policies löschen falls vorhanden
DROP POLICY IF EXISTS "Authenticated users can upload employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all employee documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete employee documents" ON storage.objects;

-- Neue Policies erstellen
-- Mitarbeiter können ihre eigenen Dokumente hochladen
CREATE POLICY "Authenticated users can upload employee documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Mitarbeiter können ihre eigenen Dokumente sehen
CREATE POLICY "Users can view own employee documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Admins können alle Dokumente sehen
CREATE POLICY "Admins can view all employee documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-documents' AND
  has_role(auth.uid(), 'administrator'::app_role)
);

-- Admins können Dokumente löschen
CREATE POLICY "Admins can delete employee documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-documents' AND
  has_role(auth.uid(), 'administrator'::app_role)
);-- Add unique constraint to prevent duplicate time entries for same user on same day
-- This prevents race conditions where rapid clicks could create duplicate entries
ALTER TABLE public.time_entries
ADD CONSTRAINT time_entries_user_datum_unique UNIQUE (user_id, datum);-- Entferne die UNIQUE Constraint für (user_id, datum) um mehrere Einträge pro Tag zu ermöglichen
ALTER TABLE public.time_entries 
DROP CONSTRAINT IF EXISTS time_entries_user_datum_unique;

-- Erstelle einen Index für schnellere Abfragen auf user_id + datum
CREATE INDEX IF NOT EXISTS idx_time_entries_user_datum 
ON public.time_entries(user_id, datum);-- Add pause_start and pause_end columns to time_entries table
ALTER TABLE time_entries 
ADD COLUMN pause_start time without time zone,
ADD COLUMN pause_end time without time zone;-- Neuen Storage Bucket für Chef-Dateien erstellen (nur für Admins)
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-chef', 'project-chef', false);

-- SELECT: Nur Admins können Chef-Dateien sehen
CREATE POLICY "Admins can view chef files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-chef' 
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);

-- INSERT: Nur Admins können Chef-Dateien hochladen
CREATE POLICY "Admins can upload chef files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-chef' 
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);

-- DELETE: Nur Admins können Chef-Dateien löschen
CREATE POLICY "Admins can delete chef files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-chef' 
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);-- Create storage bucket for project notizen (notepad templates)
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-notizen', 'project-notizen', false);

-- Allow authenticated users to upload notizen
CREATE POLICY "Authenticated users can upload notizen"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'project-notizen');

-- Allow authenticated users to view notizen
CREATE POLICY "Authenticated users can view notizen"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'project-notizen');

-- Only admins can delete notizen
CREATE POLICY "Only admins can delete notizen"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-notizen' 
  AND public.has_role(auth.uid(), 'administrator')
);-- 1. Neues Feld hinzufügen mit Standard false
ALTER TABLE public.profiles ADD COLUMN is_active boolean DEFAULT false;

-- 2. ALLE existierenden Benutzer auf aktiv setzen (das System nicht zerschießen!)
UPDATE public.profiles SET is_active = true;

-- 3. Trigger anpassen: Erster Benutzer = aktiv, alle anderen = inaktiv
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_count INTEGER;
  assigned_role app_role;
  is_first_user BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO user_count FROM auth.users WHERE id != NEW.id;
  
  is_first_user := (user_count = 0);
  
  IF is_first_user THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    is_first_user
  );
  
  RETURN NEW;
END;
$$;-- Allow administrators to activate/deactivate users (and manage profiles)
-- RLS already enabled on public.profiles

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Admins can update all profiles'
  ) THEN
    CREATE POLICY "Admins can update all profiles"
    ON public.profiles
    FOR UPDATE
    USING (public.has_role(auth.uid(), 'administrator'::public.app_role));
  END IF;
END $$;
-- Add DELETE policy for user_roles table
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'administrator'::app_role));

-- Add DELETE policy for profiles table
CREATE POLICY "Admins can delete profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'administrator'::app_role));-- Make taetigkeit column optional in time_entries table
ALTER TABLE public.time_entries 
ALTER COLUMN taetigkeit DROP NOT NULL;-- Add week_type column to time_entries for storing long/short week info
ALTER TABLE public.time_entries 
ADD COLUMN week_type TEXT CHECK (week_type IN ('kurz', 'lang'));-- Create week_settings table for storing week type per user per week
CREATE TABLE public.week_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  week_start DATE NOT NULL, -- Always the Monday of the week
  week_type TEXT NOT NULL CHECK (week_type IN ('kurz', 'lang')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);

-- Enable RLS
ALTER TABLE public.week_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own week settings"
  ON public.week_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own week settings"
  ON public.week_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own week settings"
  ON public.week_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own week settings"
  ON public.week_settings FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all week settings"
  ON public.week_settings FOR SELECT
  USING (has_role(auth.uid(), 'administrator'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_week_settings_updated_at
  BEFORE UPDATE ON public.week_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();-- Update handle_new_user trigger: All users active immediately, office@moebel-eder.at becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role app_role;
BEGIN
  -- office@moebel-eder.at wird immer Administrator
  IF NEW.email = 'office@moebel-eder.at' THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- ALLE Nutzer sind sofort aktiv (is_active = true)
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    true
  );
  
  RETURN NEW;
END;
$function$;-- Update handle_new_user function to include napetschnig.chris@gmail.com as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role app_role;
BEGIN
  -- office@moebel-eder.at und napetschnig.chris@gmail.com werden immer Administrator
  IF NEW.email = 'office@moebel-eder.at' OR NEW.email = 'napetschnig.chris@gmail.com' THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- ALLE Nutzer sind sofort aktiv (is_active = true)
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    true
  );
  
  RETURN NEW;
END;
$function$;-- Create materials table for text-based material entries
CREATE TABLE public.material_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  material TEXT NOT NULL,
  menge TEXT,
  notizen TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.material_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view material entries"
ON public.material_entries
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own material entries"
ON public.material_entries
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own material entries"
ON public.material_entries
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete any material entries"
ON public.material_entries
FOR DELETE
USING (has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Users can delete own material entries"
ON public.material_entries
FOR DELETE
USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_material_entries_updated_at
BEFORE UPDATE ON public.material_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();-- Tabelle für Störungen/Service-Einsätze
CREATE TABLE public.disturbances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Einsatzdaten
  datum DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  pause_minutes INTEGER NOT NULL DEFAULT 0,
  stunden NUMERIC NOT NULL,
  
  -- Kundendaten
  kunde_name TEXT NOT NULL,
  kunde_email TEXT,
  kunde_adresse TEXT,
  kunde_telefon TEXT,
  
  -- Arbeitsdetails
  beschreibung TEXT NOT NULL,
  notizen TEXT,
  
  -- Status für PDF-Generierung (N8N)
  status TEXT NOT NULL DEFAULT 'offen',
  pdf_gesendet_am TIMESTAMPTZ
);

-- Tabelle für verwendete Materialien bei Störungen
CREATE TABLE public.disturbance_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disturbance_id UUID NOT NULL REFERENCES public.disturbances(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  material TEXT NOT NULL,
  menge TEXT,
  notizen TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Erweiterung time_entries um disturbance_id
ALTER TABLE public.time_entries 
ADD COLUMN disturbance_id UUID REFERENCES public.disturbances(id) ON DELETE SET NULL;

-- RLS aktivieren
ALTER TABLE public.disturbances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disturbance_materials ENABLE ROW LEVEL SECURITY;

-- RLS Policies für disturbances
CREATE POLICY "Users can view own disturbances"
ON public.disturbances FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all disturbances"
ON public.disturbances FOR SELECT
USING (has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Users can insert own disturbances"
ON public.disturbances FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own disturbances"
ON public.disturbances FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can update all disturbances"
ON public.disturbances FOR UPDATE
USING (has_role(auth.uid(), 'administrator'::app_role));

CREATE POLICY "Users can delete own disturbances"
ON public.disturbances FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete all disturbances"
ON public.disturbances FOR DELETE
USING (has_role(auth.uid(), 'administrator'::app_role));

-- RLS Policies für disturbance_materials
CREATE POLICY "Authenticated users can view disturbance materials"
ON public.disturbance_materials FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own disturbance materials"
ON public.disturbance_materials FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own disturbance materials"
ON public.disturbance_materials FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own disturbance materials"
ON public.disturbance_materials FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete any disturbance materials"
ON public.disturbance_materials FOR DELETE
USING (has_role(auth.uid(), 'administrator'::app_role));

-- Trigger für updated_at
CREATE TRIGGER update_disturbances_updated_at
BEFORE UPDATE ON public.disturbances
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_disturbance_materials_updated_at
BEFORE UPDATE ON public.disturbance_materials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();-- Add signature columns to disturbances table
ALTER TABLE public.disturbances
ADD COLUMN IF NOT EXISTS unterschrift_kunde TEXT,
ADD COLUMN IF NOT EXISTS unterschrift_am TIMESTAMPTZ;-- Update handle_new_user function to also make office@elektro-brodnig.at an administrator
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role app_role;
BEGIN
  -- Diese E-Mails werden immer Administrator
  IF NEW.email = 'office@moebel-eder.at' OR NEW.email = 'napetschnig.chris@gmail.com' OR NEW.email = 'office@elektro-brodnig.at' THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- ALLE Nutzer sind sofort aktiv (is_active = true)
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    true
  );
  
  RETURN NEW;
END;
$function$;-- Tabelle für Mitarbeiter-Zuordnung bei Störungen/Regiearbeiten
CREATE TABLE public.disturbance_workers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  disturbance_id UUID NOT NULL REFERENCES public.disturbances(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  is_main BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: Ein Mitarbeiter kann nur einmal pro Störung eingetragen sein
ALTER TABLE public.disturbance_workers 
  ADD CONSTRAINT unique_disturbance_worker UNIQUE (disturbance_id, user_id);

-- Enable RLS
ALTER TABLE public.disturbance_workers ENABLE ROW LEVEL SECURITY;

-- RLS Policies für disturbance_workers
CREATE POLICY "Authenticated users can view disturbance workers"
  ON public.disturbance_workers FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert disturbance workers for own disturbances"
  ON public.disturbance_workers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.disturbances 
      WHERE id = disturbance_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can update disturbance workers for own disturbances"
  ON public.disturbance_workers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.disturbances 
      WHERE id = disturbance_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can delete disturbance workers for own disturbances"
  ON public.disturbance_workers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.disturbances 
      WHERE id = disturbance_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

-- Tabelle für Mitarbeiter-Zuordnung bei Projekt-Zeiteinträgen
CREATE TABLE public.time_entry_workers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_entry_id UUID NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  target_entry_id UUID NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint
ALTER TABLE public.time_entry_workers 
  ADD CONSTRAINT unique_time_entry_worker UNIQUE (source_entry_id, user_id);

-- Enable RLS
ALTER TABLE public.time_entry_workers ENABLE ROW LEVEL SECURITY;

-- RLS Policies für time_entry_workers
CREATE POLICY "Users can view own time entry workers"
  ON public.time_entry_workers FOR SELECT
  USING (
    user_id = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM public.time_entries 
      WHERE id = source_entry_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can insert time entry workers for own entries"
  ON public.time_entry_workers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.time_entries 
      WHERE id = source_entry_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );

CREATE POLICY "Users can delete time entry workers for own entries"
  ON public.time_entry_workers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.time_entries 
      WHERE id = source_entry_id AND user_id = auth.uid()
    )
    OR has_role(auth.uid(), 'administrator'::app_role)
  );-- (alte Seed-Daten entfernt)

-- Teil 2: Funktion für automatische Profil-Erstellung bei erstem Login
CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  user_email text;
  user_meta jsonb;
  assigned_role app_role;
BEGIN
  -- Get current user from auth context
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Check if profile already exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = current_user_id) THEN
    RETURN json_build_object('success', true, 'action', 'existing');
  END IF;
  
  -- Get user metadata from auth.users
  SELECT email, raw_user_meta_data 
  INTO user_email, user_meta
  FROM auth.users 
  WHERE id = current_user_id;
  
  -- Determine role based on email
  IF user_email IN ('office@moebel-eder.at', 'napetschnig.chris@gmail.com', 'office@elektro-brodnig.at') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  -- Create profile
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    current_user_id,
    COALESCE(user_meta->>'vorname', ''),
    COALESCE(user_meta->>'nachname', ''),
    true
  );
  
  -- Create role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN json_build_object(
    'success', true, 
    'action', 'created',
    'role', assigned_role
  );
END;
$$;-- Create app_settings table for application configuration
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can read settings (needed for Edge Functions)
CREATE POLICY "Authenticated users can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only admins can manage settings (insert, update, delete)
CREATE POLICY "Admins can manage settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

-- Insert initial value with current office email
INSERT INTO public.app_settings (key, value)
VALUES ('disturbance_report_email', 'office@elektro-brodnig.at');-- Create disturbance_photos table
CREATE TABLE public.disturbance_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disturbance_id uuid NOT NULL REFERENCES public.disturbances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.disturbance_photos ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view disturbance photos"
ON public.disturbance_photos FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own disturbance photos"
ON public.disturbance_photos FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own disturbance photos"
ON public.disturbance_photos FOR DELETE
USING (auth.uid() = user_id OR has_role(auth.uid(), 'administrator'));

-- Create storage bucket for disturbance photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('disturbance-photos', 'disturbance-photos', true);

-- Storage policies
CREATE POLICY "Users can upload disturbance photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'disturbance-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view disturbance photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'disturbance-photos');

CREATE POLICY "Users can delete own disturbance photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'disturbance-photos' AND auth.uid() IS NOT NULL);ALTER TABLE disturbances 
ADD COLUMN is_verrechnet boolean NOT NULL DEFAULT false;-- Mitarbeiter können in ihren eigenen Ordner Krankmeldungen hochladen
CREATE POLICY "Users can upload own sick notes"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'krankmeldung'
  );

-- Mitarbeiter können eigene Krankmeldungen löschen
CREATE POLICY "Users can delete own sick notes"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'employee-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'krankmeldung'
  );-- Update standard disturbance report email to ePower GmbH
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('disturbance_report_email', 'hallo@epowergmbh.at', now())
ON CONFLICT (key) DO UPDATE SET value = 'hallo@epowergmbh.at', updated_at = now();

-- Add hallo@epowergmbh.at as administrator in handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role app_role;
BEGIN
  -- Diese E-Mails werden immer Administrator
  IF NEW.email = 'office@moebel-eder.at' 
     OR NEW.email = 'napetschnig.chris@gmail.com' 
     OR NEW.email = 'office@elektro-brodnig.at'
     OR NEW.email = 'hallo@epowergmbh.at' THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);
  
  -- ALLE Nutzer sind sofort aktiv (is_active = true)
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    true
  );
  
  RETURN NEW;
END;
$function$;

-- Also update ensure_user_profile function
CREATE OR REPLACE FUNCTION public.ensure_user_profile()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid;
  user_email text;
  user_meta jsonb;
  assigned_role app_role;
BEGIN
  -- Get current user from auth context
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Check if profile already exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = current_user_id) THEN
    RETURN json_build_object('success', true, 'action', 'existing');
  END IF;
  
  -- Get user metadata from auth.users
  SELECT email, raw_user_meta_data 
  INTO user_email, user_meta
  FROM auth.users 
  WHERE id = current_user_id;
  
  -- Determine role based on email
  IF user_email IN ('office@moebel-eder.at', 'napetschnig.chris@gmail.com', 'office@elektro-brodnig.at', 'hallo@epowergmbh.at') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'mitarbeiter';
  END IF;
  
  -- Create profile
  INSERT INTO public.profiles (id, vorname, nachname, is_active)
  VALUES (
    current_user_id,
    COALESCE(user_meta->>'vorname', ''),
    COALESCE(user_meta->>'nachname', ''),
    true
  );
  
  -- Create role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN json_build_object(
    'success', true, 
    'action', 'created',
    'role', assigned_role
  );
END;
$function$;-- Profil für page.research@gmail.com erstellen
INSERT INTO public.profiles (id, vorname, nachname, is_active)
SELECT id, 'Max', 'Mustermann', true
FROM auth.users
WHERE email = 'page.research@gmail.com'
ON CONFLICT (id) DO NOTHING;

-- Rolle zuweisen
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'mitarbeiter'::app_role
FROM auth.users
WHERE email = 'page.research@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;-- Schritt 1: Profil für napetschnig.chris@gmail.com erstellen
INSERT INTO public.profiles (id, vorname, nachname, is_active)
SELECT id, 'Max', 'Mustermann', true
FROM auth.users
WHERE email = 'napetschnig.chris@gmail.com'
ON CONFLICT (id) DO NOTHING;

-- Schritt 2: Administrator-Rolle zuweisen (diese E-Mail ist in der Whitelist)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'administrator'::app_role
FROM auth.users
WHERE email = 'napetschnig.chris@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Schritt 3: Mitarbeiter-Eintrag erstellen
INSERT INTO public.employees (user_id, vorname, nachname, email)
SELECT id, 'Max', 'Mustermann', 'napetschnig.chris@gmail.com'
FROM auth.users
WHERE email = 'napetschnig.chris@gmail.com'
ON CONFLICT DO NOTHING;

-- Schritt 4: Trigger für zukünftige Registrierungen reparieren
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
-- Tabelle für Rechnungen und Angebote
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id),
  typ TEXT NOT NULL DEFAULT 'rechnung' CHECK (typ IN ('rechnung', 'angebot')),
  nummer TEXT NOT NULL UNIQUE,
  laufnummer INTEGER NOT NULL,
  jahr INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'gesendet', 'bezahlt', 'storniert', 'abgelehnt', 'angenommen')),
  
  -- Kundendaten
  kunde_name TEXT NOT NULL,
  kunde_adresse TEXT,
  kunde_plz TEXT,
  kunde_ort TEXT,
  kunde_land TEXT DEFAULT 'Österreich',
  kunde_email TEXT,
  kunde_telefon TEXT,
  kunde_uid TEXT,
  
  -- Rechnungsdetails
  datum DATE NOT NULL DEFAULT CURRENT_DATE,
  faellig_am DATE,
  leistungsdatum DATE,
  zahlungsbedingungen TEXT DEFAULT '14 Tage netto',
  notizen TEXT,
  
  -- Beträge (werden aus Positionen berechnet, hier als Cache)
  netto_summe NUMERIC NOT NULL DEFAULT 0,
  mwst_satz NUMERIC NOT NULL DEFAULT 20,
  mwst_betrag NUMERIC NOT NULL DEFAULT 0,
  brutto_summe NUMERIC NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Positionen / Zeilen
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  beschreibung TEXT NOT NULL,
  menge NUMERIC NOT NULL DEFAULT 1,
  einheit TEXT DEFAULT 'Stk.',
  einzelpreis NUMERIC NOT NULL DEFAULT 0,
  gesamtpreis NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies für invoices
CREATE POLICY "Users can view own invoices" ON public.invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all invoices" ON public.invoices FOR SELECT USING (has_role(auth.uid(), 'administrator'::app_role));
CREATE POLICY "Users can insert own invoices" ON public.invoices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own invoices" ON public.invoices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can update all invoices" ON public.invoices FOR UPDATE USING (has_role(auth.uid(), 'administrator'::app_role));
CREATE POLICY "Users can delete own invoices" ON public.invoices FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Admins can delete all invoices" ON public.invoices FOR DELETE USING (has_role(auth.uid(), 'administrator'::app_role));

-- RLS Policies für invoice_items (über parent invoice)
CREATE POLICY "Users can view own invoice items" ON public.invoice_items FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));
CREATE POLICY "Users can insert own invoice items" ON public.invoice_items FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));
CREATE POLICY "Users can update own invoice items" ON public.invoice_items FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));
CREATE POLICY "Users can delete own invoice items" ON public.invoice_items FOR DELETE 
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE invoices.id = invoice_items.invoice_id AND (invoices.user_id = auth.uid() OR has_role(auth.uid(), 'administrator'::app_role))));

-- Funktion für fortlaufende Nummer
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_typ TEXT, p_jahr INTEGER DEFAULT EXTRACT(YEAR FROM now())::INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prefix TEXT;
  next_num INTEGER;
  result TEXT;
BEGIN
  IF p_typ = 'rechnung' THEN prefix := 'RE';
  ELSIF p_typ = 'angebot' THEN prefix := 'AN';
  ELSE RAISE EXCEPTION 'Ungültiger Typ: %', p_typ;
  END IF;

  SELECT COALESCE(MAX(laufnummer), 0) + 1 INTO next_num
  FROM public.invoices
  WHERE typ = p_typ AND jahr = p_jahr;

  result := prefix || '-' || p_jahr || '-' || LPAD(next_num::TEXT, 3, '0');
  RETURN result;
END;
$$;

-- Updated_at Trigger
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 1. LEAVE BALANCES - Urlaubskontingent pro Mitarbeiter/Jahr
-- =============================================
CREATE TABLE public.leave_balances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  year INTEGER NOT NULL DEFAULT EXTRACT(year FROM now()),
  total_days NUMERIC NOT NULL DEFAULT 25,
  used_days NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, year)
);

ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leave balance"
  ON public.leave_balances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all leave balances"
  ON public.leave_balances FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert leave balances"
  ON public.leave_balances FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update leave balances"
  ON public.leave_balances FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete leave balances"
  ON public.leave_balances FOR DELETE
  USING (has_role(auth.uid(), 'administrator'));

-- =============================================
-- 2. LEAVE REQUESTS - Urlaubsanträge
-- =============================================
CREATE TABLE public.leave_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'urlaub',
  status TEXT NOT NULL DEFAULT 'beantragt',
  notizen TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leave requests"
  ON public.leave_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own leave requests"
  ON public.leave_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pending leave requests"
  ON public.leave_requests FOR DELETE
  USING (auth.uid() = user_id AND status = 'beantragt');

CREATE POLICY "Admins can view all leave requests"
  ON public.leave_requests FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update all leave requests"
  ON public.leave_requests FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete all leave requests"
  ON public.leave_requests FOR DELETE
  USING (has_role(auth.uid(), 'administrator'));

-- =============================================
-- 3. TIME ACCOUNTS - Zeitkonto pro Mitarbeiter
-- =============================================
CREATE TABLE public.time_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  balance_hours NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.time_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own time account"
  ON public.time_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all time accounts"
  ON public.time_accounts FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert time accounts"
  ON public.time_accounts FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update time accounts"
  ON public.time_accounts FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

-- =============================================
-- 4. TIME ACCOUNT TRANSACTIONS - Audit-Log
-- =============================================
CREATE TABLE public.time_account_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  changed_by UUID NOT NULL,
  change_type TEXT NOT NULL,
  hours NUMERIC NOT NULL,
  balance_before NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  reason TEXT,
  reference_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.time_account_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON public.time_account_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all transactions"
  ON public.time_account_transactions FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert transactions"
  ON public.time_account_transactions FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

-- Triggers for updated_at
CREATE TRIGGER update_leave_balances_updated_at
  BEFORE UPDATE ON public.leave_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_leave_requests_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_time_accounts_updated_at
  BEFORE UPDATE ON public.time_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- Allow authenticated users to insert their own time_account_transactions (for ZA deductions)
CREATE POLICY "Users can insert own transactions"
ON public.time_account_transactions
FOR INSERT
WITH CHECK (auth.uid() = user_id AND auth.uid() = changed_by);

-- Allow authenticated users to update their own time_account balance (for ZA deductions)
CREATE POLICY "Users can update own time account"
ON public.time_accounts
FOR UPDATE
USING (auth.uid() = user_id);