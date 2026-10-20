-- A record of every change: what happened, to what, and the details.
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  -- e.g. 'account.created', 'deposit.created', 'transfer.created'
  action TEXT NOT NULL,
  -- What kind of thing changed ('account', 'transaction') and its ID.
  entity_type TEXT NOT NULL,
  entity_id UUID,
  -- Details of the change, stored as flexible JSON.
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speed up looking up the history of one specific account or transaction.
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);
