-- Optional office-local hostname for a proxied system (split-horizon without touching the router):
-- the portal probes it from the browser and, when reachable, opens the system on the LAN path.
ALTER TABLE systems ADD COLUMN IF NOT EXISTS local_host text;
