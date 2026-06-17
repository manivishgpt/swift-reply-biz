CREATE POLICY "app_settings_admin_select" ON public.app_settings
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "app_settings_admin_insert" ON public.app_settings
  FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "app_settings_admin_update" ON public.app_settings
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "app_settings_admin_delete" ON public.app_settings
  FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.profiles FROM anon;

DROP POLICY IF EXISTS "realtime_messages_deny_all" ON realtime.messages;