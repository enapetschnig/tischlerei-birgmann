-- Make project_id nullable in resource_assignments (project is optional)
ALTER TABLE resource_assignments ALTER COLUMN project_id DROP NOT NULL;
