
-- Table for short-link plan sharing
CREATE TABLE public.shared_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  share_slug text NOT NULL UNIQUE,
  plan_data jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shared_plans_slug ON public.shared_plans (share_slug);
CREATE INDEX idx_shared_plans_owner ON public.shared_plans (owner_user_id);

ALTER TABLE public.shared_plans ENABLE ROW LEVEL SECURITY;

-- Owner can manage their own shared plans
CREATE POLICY "Owners can select own shared plans"
  ON public.shared_plans FOR SELECT TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Owners can insert own shared plans"
  ON public.shared_plans FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can update own shared plans"
  ON public.shared_plans FOR UPDATE TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Owners can delete own shared plans"
  ON public.shared_plans FOR DELETE TO authenticated
  USING (auth.uid() = owner_user_id);

-- Secure function for public read by slug (no listing)
CREATE OR REPLACE FUNCTION public.get_shared_plan_by_slug(slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT plan_data
  FROM public.shared_plans
  WHERE share_slug = slug AND is_active = true
  LIMIT 1;
$$;

-- Trigger for updated_at
CREATE TRIGGER update_shared_plans_updated_at
  BEFORE UPDATE ON public.shared_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
