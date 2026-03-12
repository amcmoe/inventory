# Asset Locking System

This document describes the real-time pessimistic locking system implemented for asset editing in the admin interface.

## Overview

The asset locking system prevents concurrent edits to assets by multiple users. When a user loads an asset for editing, they acquire a lock on that asset. Other users who try to edit the same asset will see a warning banner and the form will be disabled.

## Features

- **Pessimistic Locking**: Assets are locked when loaded for editing
- **Real-time Updates**: Lock status changes are broadcast instantly via Supabase Realtime
- **Heartbeat Mechanism**: Locks are kept alive with a 60-second heartbeat
- **Stale Lock Detection**: Locks older than 2 minutes are considered stale and can be taken over
- **Automatic Cleanup**: Locks are automatically released when users navigate away or close the page
- **Visual Feedback**: Lock status is displayed prominently in the UI

## Database Setup

### 1. Run the SQL Schema

Execute the SQL script located at [docs/schema/asset_locks.sql](schema/asset_locks.sql) in your Supabase SQL editor. This will create:

- `asset_locks` table with proper RLS policies
- Helper functions: `acquire_asset_lock()`, `release_asset_lock()`, `check_asset_lock()`, `cleanup_stale_asset_locks()`
- Realtime publication for the `asset_locks` table

### 2. Enable Realtime

The schema automatically enables Realtime for the `asset_locks` table:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_locks;
```

If you need to verify or manually enable Realtime:

1. Go to your Supabase dashboard
2. Navigate to Database → Replication
3. Ensure `asset_locks` is in the publication

## How It Works

### Lock Acquisition

When a user loads an asset in [admin.html](admin.html):

1. The system calls `acquire_asset_lock(asset_id, user_display_name)`
2. If no lock exists, a new lock is created
3. If a stale lock exists (>2 minutes old), it's taken over
4. If an active lock exists (owned by another user), acquisition fails
5. If the current user already owns the lock, it's refreshed (heartbeat)

### Heartbeat

Once a lock is acquired, a heartbeat runs every 60 seconds:

- Calls `acquire_asset_lock()` to refresh the `updated_at` timestamp
- Prevents the lock from becoming stale
- Runs automatically in the background

### Real-time Notifications

The system subscribes to Postgres changes on the `asset_locks` table:

- **INSERT/UPDATE**: Another user acquires or refreshes a lock → UI updates to show lock banner
- **DELETE**: Another user releases a lock → UI enables the form

### Lock Release

Locks are released when:

- User navigates away from the page (`beforeunload` event)
- User closes the tab/browser (`pagehide` event)
- User manually searches for a different asset
- Lock becomes stale (>2 minutes without heartbeat)

## User Experience

### When You Own the Lock

- Form is fully editable
- Heartbeat keeps the lock alive
- Save button is enabled
- No lock banner is displayed

### When Another User Owns the Lock

- Yellow lock banner appears at the top of the form
- Banner shows: "Locked by [User Name] at [Time]"
- All form inputs are disabled (except asset search)
- Save button is disabled
- Toast notification: "Asset is locked by [User Name]"

### When You Take Over a Stale Lock

- Lock is acquired successfully
- Toast notification: "Took over stale lock from [Previous User]"
- Form becomes fully editable

## API Functions

### `acquire_asset_lock(p_asset_id, p_locked_by_name)`

Acquires or refreshes a lock on an asset.

**Parameters:**
- `p_asset_id` (uuid): ID of the asset to lock
- `p_locked_by_name` (text): Display name of the user

**Returns:** JSONB object with:
```json
{
  "success": true,
  "locked_by": "user-uuid",
  "locked_by_name": "John Doe",
  "is_stale": false,
  "previous_lock_owner": "Jane Smith" // Only if took over stale lock
}
```

Or if lock is held by another user:
```json
{
  "success": false,
  "locked_by": "other-user-uuid",
  "locked_by_name": "Jane Smith",
  "locked_at": "2026-03-12T10:30:00Z",
  "is_stale": false,
  "error": "Asset is locked by Jane Smith"
}
```

### `release_asset_lock(p_asset_id)`

Releases the current user's lock on an asset.

**Parameters:**
- `p_asset_id` (uuid): ID of the asset to unlock

**Returns:** boolean (true if lock was found and deleted)

### `check_asset_lock(p_asset_id)`

Checks the lock status of an asset without attempting to acquire it.

**Parameters:**
- `p_asset_id` (uuid): ID of the asset to check

**Returns:** JSONB object with lock status

### `cleanup_stale_asset_locks()`

Deletes all locks older than 2 minutes. Can be run periodically as a maintenance task.

**Returns:** integer (number of stale locks deleted)

## Configuration

### Stale Lock Threshold

The default threshold is **2 minutes**. To change this, update the interval in:

- [docs/schema/asset_locks.sql](schema/asset_locks.sql) (lines with `interval '2 minutes'`)

### Heartbeat Interval

The default heartbeat interval is **60 seconds**. To change this, update:

- [docs/js/admin.js](js/admin.js) in the `startLockHeartbeat()` function (line with `60000`)

## Troubleshooting

### Locks Not Releasing

If locks are not being released when users navigate away:

1. Check browser console for errors
2. Verify `beforeunload` and `pagehide` event listeners are attached
3. Check Supabase RLS policies allow the user to delete their own locks

### Real-time Updates Not Working

If lock status changes don't appear in real-time:

1. Verify Realtime is enabled for `asset_locks` table in Supabase dashboard
2. Check browser console for WebSocket connection errors
3. Ensure the free tier has capacity (200 concurrent connections)
4. Check that `subscribeToAssetLocks()` is called on page load

### Stale Locks Accumulating

If stale locks are not being cleaned up:

1. Manually run `SELECT cleanup_stale_asset_locks();`
2. Set up a periodic cron job to call this function
3. Consider using Supabase Edge Functions with scheduled triggers

### UI Not Updating

If the lock banner doesn't appear/disappear:

1. Check browser console for JavaScript errors
2. Verify `handleLockChange()` is being called
3. Check that `currentAssetId` is set correctly
4. Inspect the DOM for `.asset-lock-banner` element

## Cost Considerations

### Supabase Realtime Free Tier

- **200 concurrent connections** included
- For a small IT team (2-5 users), this is more than sufficient
- Each browser tab with admin.html open = 1 connection

### Message Pricing (Beyond Free Tier)

- $2.50 per 1 million messages
- $10 per 1,000 peak connections (beyond quota)

For typical usage (5 users, occasional asset edits), you'll stay well within the free tier.

## Best Practices

1. **Always load assets through `loadByTag()`** to ensure proper lock acquisition
2. **Don't keep assets locked unnecessarily** - navigate away when done editing
3. **Monitor stale locks** in production environments
4. **Set up periodic cleanup** using `cleanup_stale_asset_locks()` if needed
5. **Test with multiple browser tabs** to verify real-time behavior

## Implementation Files

- **Database Schema**: [docs/schema/asset_locks.sql](schema/asset_locks.sql)
- **JavaScript Logic**: [docs/js/admin.js](js/admin.js)
  - `acquireAssetLock()` - Acquire lock via RPC
  - `releaseAssetLock()` - Release lock via RPC
  - `startLockHeartbeat()` - Start 60-second heartbeat
  - `stopLockHeartbeat()` - Stop heartbeat
  - `subscribeToAssetLocks()` - Subscribe to Realtime changes
  - `handleLockChange()` - Process Realtime events
  - `updateLockUI()` - Update UI based on lock status
  - `handleAssetLoad()` - Main orchestration function
- **Styling**: [docs/styles.css](styles.css) (`.asset-lock-banner` styles)

## Testing

### Manual Testing Steps

1. **Single User Test**:
   - Open admin.html
   - Load an asset
   - Verify no lock banner appears
   - Verify form is editable

2. **Multi-User Test**:
   - Open admin.html in two different browser tabs (or incognito + regular)
   - In Tab 1: Load asset #123
   - In Tab 2: Load the same asset #123
   - In Tab 2: Verify lock banner appears immediately
   - In Tab 2: Verify form is disabled
   - In Tab 1: Navigate away or close tab
   - In Tab 2: Verify lock banner disappears within 1-2 seconds
   - In Tab 2: Verify form becomes editable

3. **Stale Lock Test**:
   - Open admin.html and load an asset
   - Simulate network failure (disconnect internet) or kill the browser process
   - Wait 2+ minutes
   - Open admin.html again and load the same asset
   - Verify you can take over the stale lock
   - Verify toast shows "Took over stale lock from [Your Name]"

4. **Heartbeat Test**:
   - Open admin.html and load an asset
   - Keep the page open for 3+ minutes
   - Check the database: `SELECT * FROM asset_locks;`
   - Verify `updated_at` is being refreshed every ~60 seconds

## Security

- **Row Level Security (RLS)** is enabled on the `asset_locks` table
- Users can only delete their own locks
- Anyone can view locks (necessary for displaying lock status)
- All functions use `SECURITY DEFINER` with proper user validation
- Authentication is required for all lock operations

## Future Enhancements

Potential improvements to consider:

1. **Lock stealing**: Allow admins to forcibly release any lock
2. **Lock queue**: Notify users when a lock becomes available
3. **Activity tracking**: Log lock acquisition/release events
4. **Bulk operations**: Lock multiple assets at once
5. **Lock duration limits**: Auto-release after X hours
6. **Email notifications**: Alert users if their lock was taken over
