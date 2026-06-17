ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;

-- One active master key per user (revoked rows don't count).
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_master_per_user
  ON public.api_keys (user_id)
  WHERE is_master AND revoked_at IS NULL;

-- Master keys must be user-scoped, not bound to an account.
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_master_no_account;
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_master_no_account
  CHECK (NOT is_master OR account_id IS NULL);

-- Allow inserting a user-owned master key (no account_id).
DROP POLICY IF EXISTS api_keys_insert_by_account ON public.api_keys;
CREATE POLICY api_keys_insert_by_account
  ON public.api_keys
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR (is_master AND account_id IS NULL)
      OR (account_id IS NOT NULL AND can_access_account(account_id))
    )
  );

-- Allow user to rotate (update) their own master key.
DROP POLICY IF EXISTS api_keys_update_by_account ON public.api_keys;
CREATE POLICY api_keys_update_by_account
  ON public.api_keys
  FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (is_master AND user_id = auth.uid())
    OR (account_id IS NOT NULL AND can_access_account(account_id))
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (is_master AND user_id = auth.uid())
    OR (account_id IS NOT NULL AND can_access_account(account_id))
  );

-- Master keys can never be deleted (only revoked via UPDATE).
DROP POLICY IF EXISTS api_keys_delete_by_account ON public.api_keys;
CREATE POLICY api_keys_delete_by_account
  ON public.api_keys
  FOR DELETE
  TO authenticated
  USING (
    NOT is_master
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR (account_id IS NOT NULL AND can_access_account(account_id))
    )
  );