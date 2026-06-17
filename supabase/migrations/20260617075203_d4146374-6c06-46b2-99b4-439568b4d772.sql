
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'agent');
CREATE TYPE public.wa_account_status AS ENUM ('disconnected', 'connecting', 'connected', 'banned', 'error');
CREATE TYPE public.msg_direction AS ENUM ('in', 'out');
CREATE TYPE public.msg_type AS ENUM ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'system');
CREATE TYPE public.msg_status AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');
CREATE TYPE public.pipeline_stage AS ENUM ('new', 'qualified', 'customer', 'lost');
CREATE TYPE public.rule_trigger AS ENUM ('keyword', 'regex', 'any');
CREATE TYPE public.broadcast_status AS ENUM ('draft', 'scheduled', 'running', 'completed', 'failed', 'canceled');
CREATE TYPE public.recipient_status AS ENUM ('pending', 'sent', 'delivered', 'failed');

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =============== profiles ===============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  );
  -- First user becomes admin, all others become agents
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent');
  END IF;
  RETURN NEW;
END; $$;

-- =============== user_roles ===============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- now create the trigger that needs has_role/user_roles
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============== wa_accounts ===============
CREATE TABLE public.wa_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  phone TEXT,
  status public.wa_account_status NOT NULL DEFAULT 'disconnected',
  last_qr TEXT,
  last_qr_at TIMESTAMPTZ,
  ai_prompt TEXT DEFAULT 'You are a helpful business assistant. Be concise, friendly, and professional.',
  auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  business_hours JSONB DEFAULT '{"enabled":false,"timezone":"UTC","hours":{"mon":[9,18],"tue":[9,18],"wed":[9,18],"thu":[9,18],"fri":[9,18],"sat":null,"sun":null}}'::jsonb,
  throttle_per_min INT NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_accounts TO authenticated;
GRANT ALL ON public.wa_accounts TO service_role;
ALTER TABLE public.wa_accounts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_wa_accounts_updated_at BEFORE UPDATE ON public.wa_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============== wa_account_agents ===============
CREATE TABLE public.wa_account_agents (
  account_id UUID NOT NULL REFERENCES public.wa_accounts(id) ON DELETE CASCADE,
  agent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, agent_user_id)
);
GRANT SELECT, INSERT, DELETE ON public.wa_account_agents TO authenticated;
GRANT ALL ON public.wa_account_agents TO service_role;
ALTER TABLE public.wa_account_agents ENABLE ROW LEVEL SECURITY;

-- helper: can current user access this account?
CREATE OR REPLACE FUNCTION public.can_access_account(_account_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.wa_account_agents WHERE account_id = _account_id AND agent_user_id = auth.uid());
$$;

-- wa_accounts policies (now that helper exists)
CREATE POLICY "wa_accounts_select_assigned_or_admin" ON public.wa_accounts FOR SELECT TO authenticated
  USING (public.can_access_account(id));
CREATE POLICY "wa_accounts_admin_manage" ON public.wa_accounts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "wa_account_agents_select" ON public.wa_account_agents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR agent_user_id = auth.uid());
CREATE POLICY "wa_account_agents_admin_manage" ON public.wa_account_agents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============== contacts ===============
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.wa_accounts(id) ON DELETE CASCADE,
  wa_jid TEXT NOT NULL,
  display_name TEXT,
  phone TEXT,
  pipeline_stage public.pipeline_stage NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, wa_jid)
);
CREATE INDEX idx_contacts_account ON public.contacts(account_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "contacts_access" ON public.contacts FOR SELECT TO authenticated USING (public.can_access_account(account_id));
CREATE POLICY "contacts_modify" ON public.contacts FOR ALL TO authenticated
  USING (public.can_access_account(account_id)) WITH CHECK (public.can_access_account(account_id));

-- =============== contact_tags ===============
CREATE TABLE public.contact_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, tag)
);
GRANT SELECT, INSERT, DELETE ON public.contact_tags TO authenticated;
GRANT ALL ON public.contact_tags TO service_role;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contact_tags_access" ON public.contact_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND public.can_access_account(c.account_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND public.can_access_account(c.account_id)));

-- =============== conversations ===============
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.wa_accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  unread_count INT NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, contact_id)
);
CREATE INDEX idx_conv_account_last ON public.conversations(account_id, last_message_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_conv_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "conv_access" ON public.conversations FOR SELECT TO authenticated USING (public.can_access_account(account_id));
CREATE POLICY "conv_modify" ON public.conversations FOR ALL TO authenticated
  USING (public.can_access_account(account_id)) WITH CHECK (public.can_access_account(account_id));

-- =============== messages ===============
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction public.msg_direction NOT NULL,
  type public.msg_type NOT NULL DEFAULT 'text',
  body TEXT,
  media_url TEXT,
  status public.msg_status NOT NULL DEFAULT 'pending',
  wa_message_id TEXT,
  sent_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_by_ai BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conv ON public.messages(conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_access" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND public.can_access_account(c.account_id)));
CREATE POLICY "messages_modify" ON public.messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND public.can_access_account(c.account_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND public.can_access_account(c.account_id)));

-- =============== reply_rules ===============
CREATE TABLE public.reply_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.wa_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type public.rule_trigger NOT NULL DEFAULT 'keyword',
  pattern TEXT NOT NULL,
  response_template TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rules_account ON public.reply_rules(account_id, priority);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reply_rules TO authenticated;
GRANT ALL ON public.reply_rules TO service_role;
ALTER TABLE public.reply_rules ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_rules_updated_at BEFORE UPDATE ON public.reply_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "rules_select" ON public.reply_rules FOR SELECT TO authenticated USING (public.can_access_account(account_id));
CREATE POLICY "rules_admin_manage" ON public.reply_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============== broadcasts ===============
CREATE TABLE public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.wa_accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  media_url TEXT,
  status public.broadcast_status NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  throttle_per_min INT NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_broadcasts_updated_at BEFORE UPDATE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "broadcasts_select" ON public.broadcasts FOR SELECT TO authenticated USING (public.can_access_account(account_id));
CREATE POLICY "broadcasts_admin_manage" ON public.broadcasts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============== broadcast_recipients ===============
CREATE TABLE public.broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status public.recipient_status NOT NULL DEFAULT 'pending',
  error TEXT,
  sent_at TIMESTAMPTZ,
  UNIQUE (broadcast_id, contact_id)
);
CREATE INDEX idx_br_status ON public.broadcast_recipients(broadcast_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated;
GRANT ALL ON public.broadcast_recipients TO service_role;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "br_select" ON public.broadcast_recipients FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.broadcasts b WHERE b.id = broadcast_id AND public.can_access_account(b.account_id)));
CREATE POLICY "br_admin_manage" ON public.broadcast_recipients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============== api_keys ===============
CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_keys_own" ON public.api_keys FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "api_keys_admin_manage" ON public.api_keys FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============== webhook_events ===============
CREATE TABLE public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- no policies: server-only via service_role

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_accounts;
