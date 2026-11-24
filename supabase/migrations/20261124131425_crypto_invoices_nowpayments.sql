-- NOWPayments crypto membership invoices (manual period buy; cards stay on Stripe).

CREATE TABLE IF NOT EXISTS public.crypto_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'nowpayments'
    CHECK (provider = 'nowpayments'),
  provider_invoice_id text,
  order_id text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('basic', 'advanced')),
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  extra_accounts integer NOT NULL DEFAULT 0
    CHECK (extra_accounts >= 0 AND extra_accounts <= 95),
  amount_usd numeric(12, 2) NOT NULL CHECK (amount_usd > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'finished', 'failed', 'expired')),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crypto_invoices_order_id_key UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS crypto_invoices_user_id_idx
  ON public.crypto_invoices (user_id);

CREATE INDEX IF NOT EXISTS crypto_invoices_provider_invoice_id_idx
  ON public.crypto_invoices (provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crypto_invoices_status_created_idx
  ON public.crypto_invoices (status, created_at DESC);

ALTER TABLE public.crypto_invoices ENABLE ROW LEVEL SECURITY;

-- Service role (edge functions) bypasses RLS; no anon/authenticated policies.
REVOKE ALL ON TABLE public.crypto_invoices FROM anon, authenticated;
GRANT ALL ON TABLE public.crypto_invoices TO service_role;
