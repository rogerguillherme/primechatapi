
-- Campaign events table for tracking all campaign interactions
CREATE TABLE public.campaign_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES public.broadcast_jobs(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  lead_phone TEXT,
  event_type TEXT NOT NULL DEFAULT 'sent',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for fast lookups
CREATE INDEX idx_campaign_events_campaign_id ON public.campaign_events(campaign_id);
CREATE INDEX idx_campaign_events_event_type ON public.campaign_events(event_type);
CREATE INDEX idx_campaign_events_lead_phone ON public.campaign_events(lead_phone);

-- Enable RLS
ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;

-- Users can view campaign events for their own campaigns
CREATE POLICY "Users can view own campaign events"
ON public.campaign_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.broadcast_jobs
    WHERE broadcast_jobs.id = campaign_events.campaign_id
    AND broadcast_jobs.user_id = auth.uid()
  )
);

-- Users can insert campaign events for their own campaigns
CREATE POLICY "Users can insert own campaign events"
ON public.campaign_events
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.broadcast_jobs
    WHERE broadcast_jobs.id = campaign_events.campaign_id
    AND broadcast_jobs.user_id = auth.uid()
  )
);

-- Service role needs full access (for edge functions)
CREATE POLICY "Service can manage all campaign events"
ON public.campaign_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Click tracking links table
CREATE TABLE public.click_tracking_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES public.broadcast_jobs(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  lead_phone TEXT,
  original_url TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_click_tracking_short_code ON public.click_tracking_links(short_code);

ALTER TABLE public.click_tracking_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own click tracking links"
ON public.click_tracking_links
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.broadcast_jobs
    WHERE broadcast_jobs.id = click_tracking_links.campaign_id
    AND broadcast_jobs.user_id = auth.uid()
  )
);

CREATE POLICY "Service can manage all click tracking links"
ON public.click_tracking_links
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Enable realtime for campaign events
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_events;
