<?php
/**
 * Runs only when the plugin is deleted from wp-admin > Plugins (not on
 * deactivate). Removes the plugin's own options and its local archive
 * table. Does NOT touch any variant posts it created — those are ordinary
 * WordPress posts by this point and are the site owner's to manage.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
	exit;
}

delete_option('tcwab_hub_url');
delete_option('tcwab_site_key');
delete_option('tcwab_site_secret');
delete_option('tcwab_runtime_config');
delete_option('tcwab_permanent_rules');
delete_option('tcwab_include_staff');
delete_option('tcwab_db_version');

global $wpdb;
$table = $wpdb->prefix . 'tcwab_archive';
// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- static, non-user-controlled table name
$wpdb->query("DROP TABLE IF EXISTS {$table}");
