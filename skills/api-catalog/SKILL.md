---
name: api-catalog
description: Compressed catalog of all Nixopus API operations for the nixopus_api() tool
---

[api-catalog]
Use `nixopusApi({ operation, params })` for ALL API calls below.
Dedicated tools (quick_deploy, create_project, resolve_context) — call directly, NOT via nixopusApi.
Operations marked ⚠ require user approval — nixopusApi returns confirmation prompt first.

PARAMS FORMAT: Always pass FLAT key-value params — no query/body/path wrappers needed.
The prefix (query., body., path.) in the listing below shows the API transport layer; strip it when calling.
- `query.id` → params: `{ id: "uuid" }` (NOT `application_id` — the field is literally `id`)
- `body.id` → params: `{ id: "uuid" }`
- `path.deployment_id` → params: `{ deployment_id: "uuid" }`
Example: `nixopusApi({ operation: "get_application_deployments", params: { id: "app-uuid-here", limit: 3 } })`

## Applications
get_applications|READ|page?, page_size?, sort_by?, sort_direction?, verbose?
get_application|READ|query.id (app UUID)
get_application_deployments|READ|query.id (app UUID), query.page?, query.limit?
get_deployment_by_id|READ|path.deployment_id (deployment UUID, NOT app ID)
get_deployment_logs|READ|deployment_id, page?, page_size?, level?, start_time?, end_time?, search_term?, verbose?
get_application_logs|READ|application_id (app UUID), same log filters
⚠ create_application|MUTATING|repository (STRING!), source?, name?, branch?, port?, build_pack?, dockerfile_path?, base_path?, environment_variables?, build_variables?, domains?, compose_domains?
delete_application|DESTRUCTIVE|body.id (app UUID)
update_application|MUTATING|body.id, fields to change: name, port, env vars, build_pack, domains, etc. Does NOT redeploy
update_application_labels|MUTATING|id, labels (string[] — full list, overwrites)
add_application_domain|MUTATING|id, domain, service_name? (Compose), port?
remove_application_domain|MUTATING|id, domain
⚠ restart_deployment|MUTATING|body.id (deployment UUID). No rebuild
⚠ rollback_deployment|MUTATING|body.id (target older deployment UUID)
redeploy_application|MUTATING|body.id (app UUID), force?, force_without_cache?
preview_compose|READ|body: repository, branch?, dockerfile_path?, base_path?
⚠ recover_application|MUTATING|body.application_id (NOT body.id)
get_compose_services|READ|query.id (app UUID, Compose only)

## Projects
deploy_project|MUTATING|body.id (app UUID). Do not re-pass source
duplicate_project|MUTATING|zDuplicateProjectData
get_project_family|READ|query (family/app identifier)
get_environments_in_family|READ|query (family identifier)
add_project_to_family|MUTATING|zAddProjectToFamilyData

## Domains
create_domain|MUTATING|body.name (FQDN)
update_domain|MUTATING|body.id (domain UUID)
delete_domain|DESTRUCTIVE|body.id (domain UUID)
generate_random_subdomain|READ|no params
get_domains|READ|query.type?

## GitHub Connectors
create_github_connector|MUTATING|body: app_id, client_id, client_secret, pem, slug, webhook_secret
update_github_connector|MUTATING|body: connector_id, installation_id
delete_github_connector|DESTRUCTIVE|body.id
get_github_connectors|READ|none
get_github_repositories|READ|none
get_github_repository_branches|READ|body.repository_name (owner/repo)

## Containers
list_containers|READ|page?, limit?, status?, search?, fields?, verbose?
get_container|READ|container_id (path)
get_container_logs|READ|container_id, follow?, tail?, since?, until?, stdout?, stderr?
start_container|MUTATING|container_id (path)
stop_container|MUTATING|container_id (path)
restart_container|MUTATING|container_id (path)
remove_container|DESTRUCTIVE|container_id (path)
update_container_resources|MUTATING|container_id + cpu_shares?, memory?, memory_swap?
list_images|READ|zListImagesData
prune_build_cache|DESTRUCTIVE|zPruneBuildCacheData
prune_images|DESTRUCTIVE|zPruneImagesData

## Machine
get_machine_stats|READ|none — full CPU/RAM/disk/network snapshot
host_exec|MUTATING|command (string, runs on host via SSH)
get_machine_lifecycle_status|READ|none — active/state/pid/uptime
⚠ restart_machine|MUTATING|interrupts all services
⚠ pause_machine|MUTATING|stops processing, retains state
⚠ resume_machine|MUTATING|resumes from paused state
get_machine_metrics|READ|query: period/range for time-series
get_machine_metrics_summary|READ|query: summarized averages/peaks
get_machine_events|READ|query: lifecycle events over time

## System
get_servers|READ|limit?, fields?, verbose?
get_servers_ssh_status|READ|query
get_server_ssh_status|READ|server_id (path)
get_audit_logs|READ|query (filters, pagination)
get_feature_flags|READ|query
check_feature_flag|READ|query (key/context)
⚠ update_feature_flags|MUTATING|flag value
get_system_health|READ|spread
check_for_updates|READ|query
⚠ trigger_update|MUTATING|performs system update
send_webhook|MUTATING|webhook event payload
get_application_servers|READ|application_id (path)
set_application_servers|MUTATING|application_id, server_ids
set_server_as_org_default|MUTATING|server_id (path)

## Extensions
list_extensions|READ|query (pagination)
get_extension|READ|id (path)
get_extension_by_extension_id|READ|extension_id (path)
get_extension_categories|READ|query

## Backups
get_backup_schedule|READ|query
update_backup_schedule|MUTATING|schedule fields
list_machine_backups|READ|query
⚠ trigger_machine_backup|MUTATING|triggers backup now

## MCP Servers
list_mcp_provider_catalog|READ|query
list_org_mcp_servers|READ|query
add_mcp_server|MUTATING|name, provider, configuration
update_mcp_server|MUTATING|server config
⚠ delete_mcp_server|DESTRUCTIVE|server ID
test_mcp_server_connection|READ|connection test input
discover_mcp_tools|READ|query
list_enabled_mcp_servers|READ|query
call_mcp_tool|MUTATING|server_id, tool_name, arguments

## Notifications
send_slack_notification|MUTATING|message
send_discord_notification|MUTATING|message
send_email_notification|MUTATING|message, subject?, to?
send_notification|MUTATING|channel (slack|discord|email), message, subject?, to?, metadata?

## Notification Config
get_notification_preferences|READ|query
update_notification_preferences|MUTATING|preferences
get_smtp_config|READ|query
create_smtp_config|MUTATING|SMTP config
update_smtp_config|MUTATING|SMTP config
delete_smtp_config|DESTRUCTIVE|config ID
get_webhook_notification|READ|type (path)
create_webhook_notification|MUTATING|webhook config
update_webhook_notification|MUTATING|webhook config
delete_webhook_notification|DESTRUCTIVE|config ID

## Health Checks
create_health_check|MUTATING|health check config
get_health_check|READ|query
update_health_check|MUTATING|health check config
delete_health_check|DESTRUCTIVE|query
toggle_health_check|MUTATING|toggle config
get_health_check_results|READ|query
get_health_check_stats|READ|query

## Files
list_files|READ|path/list params
create_directory|MUTATING|directory path
move_directory|MUTATING|source, dest
copy_directory|MUTATING|source, dest
upload_file|MUTATING|file data
delete_directory|DESTRUCTIVE|directory path
[/api-catalog]
