
-- Fix conflicting permissive deny policies. Permissive policies combine via OR,
-- so a permissive USING (false) does nothing when another permissive policy
-- grants access. Drop the no-op deny on public.messages, and convert the
-- deny-all policies on webhook_events and realtime.messages to RESTRICTIVE
-- so they cannot be bypassed.

-- 1) public.messages: drop the conflicting permissive deny-all.
DROP POLICY IF EXISTS realtime_messages_deny_all ON public.messages;

-- 2) public.webhook_events: replace permissive deny with restrictive deny.
DROP POLICY IF EXISTS webhook_events_no_access ON public.webhook_events;
DROP POLICY IF EXISTS webhook_events_deny_all ON public.webhook_events;
CREATE POLICY webhook_events_deny_all
  ON public.webhook_events
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 3) realtime.messages: replace permissive deny with restrictive deny so no
-- client can subscribe to Realtime broadcasts directly.
DROP POLICY IF EXISTS realtime_messages_deny_all ON realtime.messages;
CREATE POLICY realtime_messages_deny_all
  ON realtime.messages
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
