
-- 1. Private schema + SECURITY DEFINER helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.can_access_account(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.wa_account_agents WHERE account_id = _account_id AND agent_user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email, NEW.raw_user_meta_data->>'avatar_url');
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent');
  END IF;
  RETURN NEW;
END; $$;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_account(uuid) TO authenticated, anon, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

-- 2. Recreate policies
DROP POLICY IF EXISTS api_keys_delete_by_account ON public.api_keys;
DROP POLICY IF EXISTS api_keys_insert_by_account ON public.api_keys;
DROP POLICY IF EXISTS api_keys_select_by_account ON public.api_keys;
DROP POLICY IF EXISTS api_keys_update_by_account ON public.api_keys;

CREATE POLICY api_keys_select_by_account ON public.api_keys FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin')
      OR (account_id IS NOT NULL AND private.can_access_account(account_id))
      OR user_id = auth.uid());

CREATE POLICY api_keys_insert_by_account ON public.api_keys FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT is_master
    AND (private.has_role(auth.uid(), 'admin')
         OR (account_id IS NOT NULL AND private.can_access_account(account_id))));

CREATE POLICY api_keys_update_by_account ON public.api_keys FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin')
      OR (is_master AND user_id = auth.uid())
      OR (account_id IS NOT NULL AND private.can_access_account(account_id)))
  WITH CHECK (private.has_role(auth.uid(), 'admin')
      OR (is_master AND user_id = auth.uid())
      OR (account_id IS NOT NULL AND private.can_access_account(account_id)));

CREATE POLICY api_keys_delete_by_account ON public.api_keys FOR DELETE TO authenticated
  USING (NOT is_master
    AND (private.has_role(auth.uid(), 'admin')
         OR (account_id IS NOT NULL AND private.can_access_account(account_id))));

DROP POLICY IF EXISTS broadcasts_admin_manage ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_select ON public.broadcasts;
CREATE POLICY broadcasts_admin_manage ON public.broadcasts FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY broadcasts_select ON public.broadcasts FOR SELECT TO authenticated
  USING (private.can_access_account(account_id));

DROP POLICY IF EXISTS br_admin_manage ON public.broadcast_recipients;
DROP POLICY IF EXISTS br_select ON public.broadcast_recipients;
CREATE POLICY br_admin_manage ON public.broadcast_recipients FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY br_select ON public.broadcast_recipients FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND private.can_access_account(b.account_id)));

DROP POLICY IF EXISTS contact_tags_access ON public.contact_tags;
CREATE POLICY contact_tags_access ON public.contact_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_tags.contact_id AND private.can_access_account(c.account_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_tags.contact_id AND private.can_access_account(c.account_id)));

DROP POLICY IF EXISTS contacts_access ON public.contacts;
DROP POLICY IF EXISTS contacts_modify ON public.contacts;
CREATE POLICY contacts_access ON public.contacts FOR SELECT TO authenticated
  USING (private.can_access_account(account_id));
CREATE POLICY contacts_modify ON public.contacts FOR ALL TO authenticated
  USING (private.can_access_account(account_id)) WITH CHECK (private.can_access_account(account_id));

DROP POLICY IF EXISTS conv_access ON public.conversations;
DROP POLICY IF EXISTS conv_modify ON public.conversations;
CREATE POLICY conv_access ON public.conversations FOR SELECT TO authenticated
  USING (private.can_access_account(account_id));
CREATE POLICY conv_modify ON public.conversations FOR ALL TO authenticated
  USING (private.can_access_account(account_id)) WITH CHECK (private.can_access_account(account_id));

DROP POLICY IF EXISTS messages_access ON public.messages;
DROP POLICY IF EXISTS messages_modify ON public.messages;
CREATE POLICY messages_access ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND private.can_access_account(c.account_id)));
CREATE POLICY messages_modify ON public.messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND private.can_access_account(c.account_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND private.can_access_account(c.account_id)));

DROP POLICY IF EXISTS rules_admin_manage ON public.reply_rules;
DROP POLICY IF EXISTS rules_select ON public.reply_rules;
CREATE POLICY rules_admin_manage ON public.reply_rules FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY rules_select ON public.reply_rules FOR SELECT TO authenticated
  USING (private.can_access_account(account_id));

DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select_own_or_admin ON public.user_roles;
CREATE POLICY user_roles_admin_manage ON public.user_roles FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY user_roles_select_own_or_admin ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS wa_account_agents_admin_manage ON public.wa_account_agents;
DROP POLICY IF EXISTS wa_account_agents_select ON public.wa_account_agents;
CREATE POLICY wa_account_agents_admin_manage ON public.wa_account_agents FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY wa_account_agents_select ON public.wa_account_agents FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR agent_user_id = auth.uid());

DROP POLICY IF EXISTS wa_accounts_admin_manage ON public.wa_accounts;
DROP POLICY IF EXISTS wa_accounts_select_assigned_or_admin ON public.wa_accounts;
CREATE POLICY wa_accounts_admin_manage ON public.wa_accounts FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY wa_accounts_select_assigned_or_admin ON public.wa_accounts FOR SELECT TO authenticated
  USING (private.can_access_account(id));

-- 3. Drop public-schema copies (no longer referenced)
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.can_access_account(uuid);
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 4. profiles: own row only
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- 5. webhook_events: explicit deny-all (service role still bypasses RLS)
DROP POLICY IF EXISTS webhook_events_no_access ON public.webhook_events;
CREATE POLICY webhook_events_no_access ON public.webhook_events FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- 6. Realtime broadcast/presence channels: deny all (CDC postgres_changes unaffected)
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS realtime_messages_deny_all ON realtime.messages;
CREATE POLICY realtime_messages_deny_all ON realtime.messages FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- 7. Move pg_net out of public (drop + recreate into extensions schema)
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
