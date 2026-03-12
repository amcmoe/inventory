-- Asset Locks Table
-- Implements pessimistic locking with heartbeat for concurrent asset editing

CREATE TABLE IF NOT EXISTS public.asset_locks (
  asset_id uuid PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  locked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_by_name text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.asset_locks ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view locks
CREATE POLICY "Anyone can view asset locks"
  ON public.asset_locks
  FOR SELECT
  USING (true);

-- Policy: Users can acquire locks (insert)
CREATE POLICY "Users can acquire locks"
  ON public.asset_locks
  FOR INSERT
  WITH CHECK (auth.uid() = locked_by);

-- Policy: Users can update their own locks (heartbeat)
CREATE POLICY "Users can update own locks"
  ON public.asset_locks
  FOR UPDATE
  USING (auth.uid() = locked_by)
  WITH CHECK (auth.uid() = locked_by);

-- Policy: Users can release their own locks
CREATE POLICY "Users can release own locks"
  ON public.asset_locks
  FOR DELETE
  USING (auth.uid() = locked_by);

-- Index for efficient stale lock detection
CREATE INDEX IF NOT EXISTS idx_asset_locks_updated_at ON public.asset_locks(updated_at);

-- Function to acquire or refresh a lock
CREATE OR REPLACE FUNCTION public.acquire_asset_lock(
  p_asset_id uuid,
  p_locked_by_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_existing_lock record;
  v_stale_threshold timestamptz;
  v_result jsonb;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if asset exists
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id = p_asset_id) THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Stale lock threshold: 2 minutes
  v_stale_threshold := now() - interval '2 minutes';

  -- Get existing lock
  SELECT * INTO v_existing_lock
  FROM public.asset_locks
  WHERE asset_id = p_asset_id;

  -- Case 1: No existing lock - create new lock
  IF v_existing_lock IS NULL THEN
    INSERT INTO public.asset_locks (asset_id, locked_by, locked_by_name, locked_at, updated_at)
    VALUES (p_asset_id, v_user_id, p_locked_by_name, now(), now());

    v_result := jsonb_build_object(
      'success', true,
      'locked_by', v_user_id,
      'locked_by_name', p_locked_by_name,
      'is_stale', false
    );
    RETURN v_result;
  END IF;

  -- Case 2: Lock is stale (older than 2 minutes) - take over
  IF v_existing_lock.updated_at < v_stale_threshold THEN
    UPDATE public.asset_locks
    SET locked_by = v_user_id,
        locked_by_name = p_locked_by_name,
        locked_at = now(),
        updated_at = now()
    WHERE asset_id = p_asset_id;

    v_result := jsonb_build_object(
      'success', true,
      'locked_by', v_user_id,
      'locked_by_name', p_locked_by_name,
      'is_stale', true,
      'previous_lock_owner', v_existing_lock.locked_by_name
    );
    RETURN v_result;
  END IF;

  -- Case 3: Current user already owns the lock - refresh it (heartbeat)
  IF v_existing_lock.locked_by = v_user_id THEN
    UPDATE public.asset_locks
    SET updated_at = now()
    WHERE asset_id = p_asset_id;

    v_result := jsonb_build_object(
      'success', true,
      'locked_by', v_user_id,
      'locked_by_name', p_locked_by_name,
      'is_stale', false
    );
    RETURN v_result;
  END IF;

  -- Case 4: Lock is held by another user and not stale
  v_result := jsonb_build_object(
    'success', false,
    'locked_by', v_existing_lock.locked_by,
    'locked_by_name', v_existing_lock.locked_by_name,
    'locked_at', v_existing_lock.locked_at,
    'is_stale', false,
    'error', 'Asset is locked by ' || v_existing_lock.locked_by_name
  );
  RETURN v_result;
END;
$$;

-- Function to release a lock
CREATE OR REPLACE FUNCTION public.release_asset_lock(p_asset_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.asset_locks
  WHERE asset_id = p_asset_id
    AND locked_by = v_user_id;

  RETURN FOUND;
END;
$$;

-- Function to check lock status
CREATE OR REPLACE FUNCTION public.check_asset_lock(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lock record;
  v_stale_threshold timestamptz;
  v_result jsonb;
BEGIN
  v_stale_threshold := now() - interval '2 minutes';

  SELECT * INTO v_lock
  FROM public.asset_locks
  WHERE asset_id = p_asset_id;

  IF v_lock IS NULL THEN
    RETURN jsonb_build_object('locked', false);
  END IF;

  IF v_lock.updated_at < v_stale_threshold THEN
    RETURN jsonb_build_object(
      'locked', true,
      'is_stale', true,
      'locked_by', v_lock.locked_by,
      'locked_by_name', v_lock.locked_by_name,
      'locked_at', v_lock.locked_at,
      'updated_at', v_lock.updated_at
    );
  END IF;

  RETURN jsonb_build_object(
    'locked', true,
    'is_stale', false,
    'locked_by', v_lock.locked_by,
    'locked_by_name', v_lock.locked_by_name,
    'locked_at', v_lock.locked_at,
    'updated_at', v_lock.updated_at
  );
END;
$$;

-- Function to clean up stale locks (can be called periodically)
CREATE OR REPLACE FUNCTION public.cleanup_stale_asset_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM public.asset_locks
  WHERE updated_at < (now() - interval '2 minutes');

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- Enable Realtime for asset_locks table
ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_locks;

COMMENT ON TABLE public.asset_locks IS 'Tracks pessimistic locks on assets to prevent concurrent edits';
COMMENT ON COLUMN public.asset_locks.asset_id IS 'Asset being locked (primary key)';
COMMENT ON COLUMN public.asset_locks.locked_by IS 'User ID who holds the lock';
COMMENT ON COLUMN public.asset_locks.locked_by_name IS 'Display name of user holding lock';
COMMENT ON COLUMN public.asset_locks.locked_at IS 'When the lock was initially acquired';
COMMENT ON COLUMN public.asset_locks.updated_at IS 'Last heartbeat timestamp - locks older than 2 minutes are stale';
