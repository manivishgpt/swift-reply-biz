
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.wa_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON public.api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_account_id_idx ON public.api_keys (account_id);

-- Replace policies to scope by account access.
DROP POLICY IF EXISTS api_keys_own ON public.api_keys;
DROP POLICY IF EXISTS api_keys_admin_manage ON public.api_keys;

CREATE POLICY api_keys_select_by_account
  ON public.api_keys FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (account_id IS NOT NULL AND public.can_access_account(account_id))
    OR user_id = auth.uid()
  );

CREATE POLICY api_keys_insert_by_account
  ON public.api_keys FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (account_id IS NOT NULL AND public.can_access_account(account_id))
    )
  );

CREATE POLICY api_keys_update_by_account
  ON public.api_keys FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (account_id IS NOT NULL AND public.can_access_account(account_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (account_id IS NOT NULL AND public.can_access_account(account_id))
  );

CREATE POLICY api_keys_delete_by_account
  ON public.api_keys FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (account_id IS NOT NULL AND public.can_access_account(account_id))
  );
