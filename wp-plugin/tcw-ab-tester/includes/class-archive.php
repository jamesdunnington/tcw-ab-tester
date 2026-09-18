<?php
/**
 * Local, permanent record that a test happened on this site. The full
 * results/decision/cleanup-manifest record lives on the hub (see
 * docs/PLAN.md section 6) — this table is deliberately minimal: just
 * enough for a WordPress admin to see "yes, this was tested" and jump to
 * the hub for the rest, even after a losing variant has been deleted.
 *
 * Phase 1 creates the table and the (empty-for-now) admin list; rows start
 * getting written once the phase-2 winner-decision flow lands.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Archive {

	public static function table_name(): string {
		global $wpdb;
		return $wpdb->prefix . 'tcwab_archive';
	}

	public static function install_table(): void {
		global $wpdb;
		$table_name      = self::table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			hub_test_id VARCHAR(64) NOT NULL,
			test_name VARCHAR(255) NOT NULL,
			wp_post_id BIGINT UNSIGNED NOT NULL,
			winner_key VARCHAR(32) DEFAULT NULL,
			redundant_deleted TINYINT(1) NOT NULL DEFAULT 0,
			started_at DATETIME DEFAULT NULL,
			decided_at DATETIME DEFAULT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY hub_test_id (hub_test_id),
			KEY wp_post_id (wp_post_id)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta($sql);

		update_option('tcwab_db_version', TCWAB_VERSION);
	}

	/** @return array<int, array<string, mixed>> */
	public function all_entries(): array {
		global $wpdb;
		$table = self::table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- static table name, no user input
		$rows = $wpdb->get_results("SELECT * FROM {$table} ORDER BY created_at DESC", ARRAY_A);
		return $rows ?: [];
	}

	public function record_test(string $hub_test_id, string $test_name, int $wp_post_id): void {
		global $wpdb;
		$wpdb->replace(
			self::table_name(),
			[
				'hub_test_id' => $hub_test_id,
				'test_name'   => $test_name,
				'wp_post_id'  => $wp_post_id,
				'created_at'  => current_time('mysql'),
			],
			['%s', '%s', '%d', '%s']
		);
	}
}
