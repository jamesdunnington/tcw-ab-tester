<?php
/**
 * Purges page caches for a post after its content or the test config
 * changes, so cached HTML never keeps serving a stale variant config
 * (docs/PLAN.md section 3). Every call is guarded, so a cache plugin that
 * isn't installed is simply a no-op. Cloudflare/CDN edge purges need API
 * credentials and are left to the tcwab_purge_post action hook.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Cache_Purge {

	public function purge_post(int $post_id): void {
		clean_post_cache($post_id);
		$url = get_permalink($post_id);

		if (function_exists('rocket_clean_post')) {
			rocket_clean_post($post_id); // WP Rocket
		}
		if (function_exists('w3tc_flush_post')) {
			w3tc_flush_post($post_id); // W3 Total Cache
		}
		if (function_exists('wp_cache_post_change')) {
			wp_cache_post_change($post_id); // WP Super Cache
		}
		do_action('litespeed_purge_post', $post_id); // LiteSpeed Cache

		/** Hook for edge/CDN purges (e.g. Cloudflare). */
		do_action('tcwab_purge_post', $post_id, $url);
	}

	/** @param int[] $post_ids */
	public function purge_posts(array $post_ids): void {
		foreach (array_unique(array_map('intval', $post_ids)) as $post_id) {
			if ($post_id > 0) {
				$this->purge_post($post_id);
			}
		}
	}
}
