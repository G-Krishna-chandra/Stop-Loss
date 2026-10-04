-- StopLoss schema. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS positions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name        text NOT NULL,
  service_domain      text NOT NULL,
  signup_email        text NOT NULL,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  renewal_date        timestamptz,
  renewal_price_cents integer,
  currency            text,
  cancel_url          text,
  status              text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','stop_pending','approved','cancelling','closed','failed','kept')),
  evidence_email_id   text
);

-- One open position per service per signup address.
CREATE UNIQUE INDEX IF NOT EXISTS positions_active_service
  ON positions (service_domain, signup_email)
  WHERE status NOT IN ('closed','failed','kept');

CREATE INDEX IF NOT EXISTS positions_due ON positions (status, renewal_date);

CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_position ON events (position_id, created_at);

CREATE TABLE IF NOT EXISTS approval_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('cancel','retention_offer')),
  detail      text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- At most one pending approval of each kind per position.
CREATE UNIQUE INDEX IF NOT EXISTS approval_one_pending
  ON approval_requests (position_id, kind)
  WHERE status = 'pending';
