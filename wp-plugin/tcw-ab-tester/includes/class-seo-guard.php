<?php
/**
 * Keeps a variant post out of Google's index and out of WordPress's own
 * front-end listings, while still leaving it reachable at its own URL for
 * an assigned visitor (see class-variants.php — variant posts are
 * post_status 'publish', not 'draft', because an anonymous visitor has to
 * be able to load them directly with no auth).
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_SEO_Guard {

	public function maybe_noindex_variant(): void {
		if (!is_singular()) {
			return;
		}
		$post_id = get_queried_object_id();
		if (!$post_id || !tcwab()->variants->is_variant($post_id)) {
			return;
		}

		add_filter('wp_robots', function (array $robots): array {
			$robots['noindex']  = true;
			$robots['nofollow'] = true;
			return $robots;
		});

		add_filter('get_canonical_url', function ($canonical_url) use ($post_id) {
			$source_id = tcwab()->variants->get_source_post_id($post_id);
			return $source_id ? get_permalink($source_id) : $canonical_url;
		});
	}

	/** Keeps variant posts out of the blog loop, search, archives, and feeds. */
	public function exclude_variants_from_queries(WP_Query $query): WP_Query {
		if (is_admin() || !$query->is_main_query()) {
			return $query;
		}

		$meta_query   = (array) $query->get('meta_query');
		$meta_query[] = [
			'key'     => '_tcwab_variant_of',
			'compare' => 'NOT EXISTS',
		];
		$query->set('meta_query', $meta_query);

		return $query;
	}
}
