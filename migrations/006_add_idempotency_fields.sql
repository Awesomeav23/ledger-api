-- Adds fields that make transfers safe to retry.

ALTER TABLE transactions
  -- Fingerprint of the request body, to detect a reused key with different data
  ADD COLUMN request_hash TEXT,
  -- The original response, returned again when the same key is retried
  ADD COLUMN response_body JSONB;
