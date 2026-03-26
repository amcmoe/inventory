# ITAM Expansion Reference (Planning Baseline)

## Scope
Expand the current ITAM app with two additional modules:

1. Applications (Software CIs)
2. Infrastructure (Infrastructure CIs)

This document captures planning decisions only (no implementation yet).

## Navigation
Add two new left-side sections:

1. Applications
2. Infrastructure

ITIL-aligned labels can be:

1. Applications (Software CIs)
2. Infrastructure (Infrastructure CIs)

## Access Model (Finalized)
Use module-specific access with exactly three levels:

1. none
2. view
3. edit

When creating/editing a user, set one access level per module:

1. Inventory Access: none | view | edit
2. Applications Access: none | view | edit
3. Infrastructure Access: none | view | edit

Notes:
- Keep this simple and explicit in the user form (three dropdowns).
- This is domain-based RBAC, not one global role.

## Applications Module (Simple by Design)
Initial fields requested:

1. Application name
2. Platform
3. Contact/owner
4. Link to website or app store page
5. Notes (recommended)

Purpose:
- Lightweight reference when staff asks about an app.

## Infrastructure Module
Desired direction:

1. List/grid management for infrastructure items (switches, APs, servers, etc.)
2. Graphical representation/topology view

Recommended delivery:

1. Start with list + filters + edit drawer/form
2. Add a map/graph tab once relationships are stored

## Data Model Recommendation
Use a shared CI core plus module detail tables.

### 1) Core CI table
`configuration_items`

Suggested columns:
- `id` (uuid, pk)
- `ci_type` (application, switch, ap, server, etc.)
- `name`
- `status`
- `owner_person_id`
- `support_contact_person_id`
- `criticality`
- `notes`
- `created_at`, `updated_at`

### 2) Application details table
`application_ci_details`

Suggested columns:
- `ci_id` (fk -> configuration_items.id)
- `platform`
- `vendor`
- `app_url`
- `app_store_url`
- `license_model`
- `environment`
- `data_classification`

### 3) Infrastructure details table
`infrastructure_ci_details`

Suggested columns:
- `ci_id` (fk -> configuration_items.id)
- `device_role`
- `manufacturer`
- `model`
- `serial`
- `ip_address`
- `location_building_id` (or plain building text to start)
- `rack`
- `warranty_end`
- `monitoring_url`

### 4) CI relationships table
`ci_relationships`

Suggested columns:
- `id` (uuid, pk)
- `source_ci_id` (fk)
- `target_ci_id` (fk)
- `relationship_type` (connects_to, hosts, depends_on, etc.)
- `notes`
- `created_at`

## Why Full Auto-Discovery / Network Sync CMDB Is Large
This is a multi-week+ effort because it requires:

1. Multiple source integrations (MDM, AD/Azure AD, network APIs/SNMP, cloud, monitoring, virtualization, etc.)
2. Record reconciliation and deduplication across systems
3. Scheduled sync pipelines, drift detection, and conflict handling
4. Relationship graph accuracy and maintenance
5. Governance rules (required fields, stale checks, ownership quality)
6. Security hardening (service accounts, secret handling, audits)

## Front-End Update Requirement
Requirement confirmed:
- Data must be easy to update from the website front end.

Recommended UX support:

1. Manual create/edit forms for all modules
2. Bulk update/import options (later phase)
3. Clear source-of-truth indicators and change history

## Suggested Phased Rollout
1. Phase 1: Applications + Infrastructure manual CRUD + RBAC (none/view/edit)
2. Phase 2: Relationship model + Infrastructure map/graph view + audit history
3. Phase 3: Imports and auto-discovery connectors with reconciliation

## ITIL-Aligned Features Worth Adding
1. CI lifecycle states (planned, active, repair, retired)
2. CI relationships/dependencies
3. Ownership and support accountability
4. Change/audit trail (who/what/when)
5. Data quality checks (missing owner, stale records, etc.)

## Naming Guidance
Is "ITAM" still appropriate?
- Yes, if asset management remains the primary focus.

If you want broader scope reflected in product naming, consider:

1. ITAM + CMDB
2. IT Operations Asset & CMDB
3. IT Service Configuration & Asset Management

